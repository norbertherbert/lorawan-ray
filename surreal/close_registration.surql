-- Run as a database owner to require administrator approval or a valid
-- invitation for newly registered Google users again. Existing approved users
-- remain approved.
USE NS lorawan DB ray;

DEFINE PARAM OVERWRITE $open_registration VALUE false
  PERMISSIONS NONE;
