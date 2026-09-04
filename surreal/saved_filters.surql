-- Saved Sniffer, PER, and Arad PER dataset filters.
-- Run as a database owner after selecting the production namespace/database.
USE NS lorawan DB ray;

DEFINE TABLE OVERWRITE saved_filter SCHEMAFULL
  PERMISSIONS
    FOR select WHERE $auth.approved = true
      AND (owner = $auth.id OR visibility = "shared")
    FOR create WHERE $auth.approved = true AND owner = $auth.id
    FOR update, delete WHERE $auth.approved = true AND owner = $auth.id;

DEFINE FIELD OVERWRITE name ON TABLE saved_filter TYPE string
  ASSERT string::len(string::trim($value)) >= 1
    AND string::len(string::trim($value)) <= 80;
DEFINE FIELD OVERWRITE description ON TABLE saved_filter TYPE option<string>
  ASSERT $value IS NONE OR string::len($value) <= 500;
DEFINE FIELD OVERWRITE visibility ON TABLE saved_filter TYPE string
  ASSERT $value IN ["private", "shared"];
DEFINE FIELD OVERWRITE owner ON TABLE saved_filter TYPE record<user>
  DEFAULT $auth.id READONLY;
DEFINE FIELD OVERWRITE owner_name ON TABLE saved_filter TYPE string
  READONLY VALUE ($auth.name ?? $auth.email ?? "Unknown user");
DEFINE FIELD OVERWRITE definition ON TABLE saved_filter TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE definition.type ON TABLE saved_filter TYPE string
  ASSERT $value IN ["sniffer", "per", "per-arad"];
DEFINE FIELD OVERWRITE definition.version ON TABLE saved_filter TYPE int
  ASSERT $value = 1;
DEFINE FIELD OVERWRITE created_at ON TABLE saved_filter TYPE datetime
  DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE updated_at ON TABLE saved_filter TYPE datetime
  VALUE time::now();

DEFINE INDEX OVERWRITE saved_filter_owner ON TABLE saved_filter FIELDS owner;
DEFINE INDEX OVERWRITE saved_filter_visibility ON TABLE saved_filter FIELDS visibility;
