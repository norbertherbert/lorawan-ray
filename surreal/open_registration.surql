-- Run as a database owner to let every verified Google user register and gain
-- packet read access immediately. The authentication Worker is unchanged.
USE NS lorawan DB ray;

UPSERT ONLY auth_config:registration
  SET open_registration = true;
