#!/usr/bin/env bash

cargo run --release -- \
  -d "https://nano-things-fre-06fekk904lvvv6p0ocvu8dm7c4.aws-euw1.surreal.cloud" \
  -u 647FDAFFFE005E17 \
  --password-file "../private/sdb_passwd_647FDAFFFE005E17.txt" \
  --log-level debug \
  -l 127.0.0.1:1701
  
