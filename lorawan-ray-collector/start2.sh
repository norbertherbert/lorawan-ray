#!/usr/bin/env bash

cargo run --release -- \
  -d "https://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud" \
  -u 7276FF002E0603AD \
  --password-file "../private/sdb_passwd_7276FF002E0603AD.txt" \
  --log-level debug \
  -l 127.0.0.1:1701
  