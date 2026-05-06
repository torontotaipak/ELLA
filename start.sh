#!/usr/bin/env bash
set -e

python manage.py migrate --noinput
python manage.py ensure_admin
gunicorn ella.wsgi:application
