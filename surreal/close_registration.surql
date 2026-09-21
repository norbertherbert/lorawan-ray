-- Run as a database owner to require administrator approval or a valid
-- invitation for newly registered Google users again. Existing approved users
-- remain approved.
USE NS lora DB manta;

UPSERT ONLY auth_config:registration
  SET open_registration = false;
