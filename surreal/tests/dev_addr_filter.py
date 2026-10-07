"""Exercise ingestion permissions using synthetic data on a disposable local engine.

Run: SURREAL_BIN=/path/to/surreal python3 surreal/tests/dev_addr_filter.py
The test starts its own authenticated in-memory server; it cannot target Cloud.
"""

import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import unittest
import urllib.error
import urllib.request
import uuid


SCRIPTS = Path(__file__).resolve().parents[1]
GATEWAY = "0000000000000001"


class PrefixFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = os.environ.get("SURREAL_BIN") or shutil.which("surreal")
        if not binary:
            raise RuntimeError("Set SURREAL_BIN or install surreal to run integration tests.")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        password = uuid.uuid4().hex
        cls.root = "Basic " + base64.b64encode(f"test:{password}".encode()).decode()
        cls.server = subprocess.Popen(
            [binary, "start", "--bind", f"127.0.0.1:{port}",
             "--no-banner", "--log", "error", "memory"],
            env={**os.environ, "SURREAL_USER": "test", "SURREAL_PASS": password},
            stdout=subprocess.DEVNULL,
        )
        cls.addClassCleanup(cls.stop_server)
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.url + "/health", timeout=1):
                    return
            except (urllib.error.URLError, TimeoutError):
                if cls.server.poll() is not None:
                    raise RuntimeError("Disposable SurrealDB exited before becoming ready.")
                time.sleep(0.1)
        raise RuntimeError("Disposable SurrealDB did not become ready.")

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)

    def request(self, path, body, auth=None):
        headers = {"Accept": "application/json", "Surreal-NS": "lora", "Surreal-DB": "manta"}
        if auth:
            headers["Authorization"] = auth
        if isinstance(body, dict):
            headers["Content-Type"] = "application/json"
            body = json.dumps(body)
        request = urllib.request.Request(self.url + path, data=body.encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def query(self, sql, auth=None):
        return self.request("/sql", sql, auth or self.root)

    def successful(self, sql, auth=None):
        result = self.query(sql, auth)
        self.assertTrue(all(row["status"] == "OK" for row in result), result)
        return result

    def apply(self, script):
        return self.successful((SCRIPTS / script).read_text())

    def setUp(self):
        self.successful("REMOVE NAMESPACE IF EXISTS lora;")
        schema = (SCRIPTS / "schema.surql").read_text()
        for placeholder, value in {
            "__SURREAL_JWT_SECRET__": "synthetic-test-signing-key-" + "x" * 64,
            "__TOKEN_ISSUER__": "test-issuer",
            "__TOKEN_AUDIENCE__": "test-audience",
            "__ADMIN_EMAIL__": "test@example.com",
        }.items():
            schema = schema.replace(placeholder, value)
        self.successful(schema)
        self.successful(
            'CREATE type::record("gateway_credential", "' + GATEWAY + '") SET '
            'name="Test gateway", password=crypto::argon2::generate("synthetic-password"), enabled=true;'
        )
        signin = self.request("/signin", {
            "NS": "lora", "DB": "manta", "AC": "gateway_writer",
            "user": GATEWAY, "pass": "synthetic-password",
        })
        self.gateway_auth = "Bearer " + signin["token"]

    def reception(self, key, address, gateway=GATEWAY):
        data = {
            "schema_version": 1, "gateway_id": gateway,
            "timestamp_source": "gateway", "raw_rxpk": {},
            "radio": {"signals": [], "modulation": "LORA"},
            "phy": {"payload_base64": "AA==", "payload_hex": "00", "payload_size": 1,
                    "payload_hash": key},
            "lorawan": {"decode_status": "decoded",
                        "mtype": "UnconfirmedDataUp" if address else "JoinRequest"},
        }
        if address is not None:
            data["lorawan"]["dev_addr"] = address
        content = json.dumps(data)[:-1] + ', observed_at:d"2026-10-03T08:00:00Z", ingested_at:time::now()}'
        return f"CREATE gateway_reception:{key} CONTENT {content} RETURN NONE;"

    def mixed_batch(self):
        self.successful(
            "BEGIN;" + self.reception("accepted", "18000001")
            + self.reception("rejected", "26000001")
            + self.reception("join_request", None) + "COMMIT;",
            self.gateway_auth,
        )

    def assert_packets(self, expected):
        rows = self.successful("SELECT VALUE record::id(id) FROM gateway_reception;")[0]["result"]
        self.assertEqual(set(rows), set(expected))
        uplinks = self.successful("SELECT receptions, reception_count, best_reception FROM lorawan_uplink;")[0]["result"]
        self.assertEqual(len(uplinks), len(expected))
        linked = set()
        for uplink in uplinks:
            self.assertEqual(uplink["reception_count"], 1)
            self.assertEqual(len(uplink["receptions"]), 1)
            self.assertEqual(uplink["best_reception"], uplink["receptions"][0])
            linked.add(uplink["receptions"][0].split(":", 1)[1])
        self.assertEqual(linked, set(expected))

    def assert_permission_events(self):
        info = self.successful("INFO FOR TABLE gateway_reception;")[0]["result"]
        self.assertEqual(set(info["events"]), {"reception_to_uplink"})
        self.assertNotIn("starts_with", info["events"]["reception_to_uplink"])

    def test_fresh_schema_filters_without_failing_mixed_batch(self):
        self.mixed_batch()
        self.assert_packets({"accepted"})
        self.assert_permission_events()

    def test_migration_from_legacy_events_is_idempotent(self):
        self.apply("rollback_dev_addr_filter.surql")
        self.apply("implement_dev_addr_filter.surql")
        self.apply("implement_dev_addr_filter.surql")
        self.mixed_batch()
        self.assert_packets({"accepted"})
        self.assert_permission_events()

    def test_rollback_restores_legacy_filter(self):
        self.apply("implement_dev_addr_filter.surql")
        self.apply("rollback_dev_addr_filter.surql")
        self.apply("rollback_dev_addr_filter.surql")
        self.mixed_batch()
        self.assert_packets({"accepted"})
        info = self.successful("INFO FOR TABLE gateway_reception;")[0]["result"]
        self.assertEqual(set(info["events"]), {"reception_to_uplink", "discard_unmatched_reception"})

    def test_disable_and_recovery_preserve_unfiltered_state(self):
        self.apply("remove_dev_addr_filter.surql")
        self.apply("remove_dev_addr_filter.surql")
        self.apply("restore_packet_tables.surql")
        self.mixed_batch()
        self.assert_packets({"accepted", "rejected", "join_request"})
        self.assert_permission_events()

    def test_recovery_preserves_changed_prefix_and_removes_legacy_events(self):
        self.apply("rollback_dev_addr_filter.surql")
        self.successful('UPDATE ONLY packet_ingest_policy:dev_addr SET prefix="26";')
        self.apply("restore_packet_tables.surql")
        self.mixed_batch()
        self.assert_packets({"rejected"})
        self.assert_permission_events()

    def test_recovery_initializes_a_missing_policy(self):
        self.successful("REMOVE TABLE packet_ingest_policy;")
        self.apply("rollback_dev_addr_filter.surql")
        self.apply("restore_packet_tables.surql")
        self.mixed_batch()
        self.assert_packets({"accepted"})

    def test_recovery_recreates_packet_tables_and_preserves_policy(self):
        self.successful('UPDATE ONLY packet_ingest_policy:dev_addr SET prefix="26";')
        self.successful("REMOVE TABLE gateway_reception; REMOVE TABLE lorawan_uplink;")
        self.apply("restore_packet_tables.surql")
        self.mixed_batch()
        self.assert_packets({"rejected"})
        self.assert_permission_events()

    def test_missing_policy_fails_closed(self):
        self.successful("DELETE ONLY packet_ingest_policy:dev_addr;")
        self.mixed_batch()
        self.assert_packets(set())

    def test_gateway_cannot_override_policy_or_write_as_another_gateway(self):
        self.assertEqual(
            self.successful("SELECT * FROM packet_ingest_policy;", self.gateway_auth)[0]["result"], []
        )
        self.successful('UPDATE packet_ingest_policy:dev_addr SET prefix="";', self.gateway_auth)
        self.successful(
            'BEGIN; LET $gateway_dev_addr_prefix="";'
            + self.reception("spoofed", "18000001", "0000000000000002")
            + self.reception("shadowed", "26000001") + "COMMIT;",
            self.gateway_auth,
        )
        self.assert_packets(set())
        self.assertEqual(
            self.successful("RETURN (packet_ingest_policy:dev_addr).prefix;")[0]["result"], "18"
        )
        self.successful('UPDATE type::record("gateway_credential", "' + GATEWAY + '") SET enabled=false;')
        self.successful(self.reception("disabled_gateway", "18000001"), self.gateway_auth)
        self.assert_packets(set())

    def test_invalid_policy_prefix_is_rejected(self):
        result = self.query('UPDATE ONLY packet_ingest_policy:dev_addr SET prefix="invalid";')
        self.assertTrue(any(row["status"] == "ERR" for row in result))


if __name__ == "__main__":
    unittest.main(verbosity=2)
