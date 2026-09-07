#!/bin/sh
# Creates the second database the test suite uses, on first container start.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE ottodot_test;
EOSQL
