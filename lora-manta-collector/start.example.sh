#!/usr/bin/env bash

cargo run --release -- \
  -d "<SurrealDB URL>" \
  -u <Gateway EUI> \
  --password-file "../<Password file>" \
  --log-level error
