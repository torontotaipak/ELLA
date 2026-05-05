import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create or update admin and worker users from environment variables."

    def handle(self, *args, **options):
        self.ensure_user(
            username=os.environ.get("DJANGO_ADMIN_USERNAME"),
            password=os.environ.get("DJANGO_ADMIN_PASSWORD"),
            email=os.environ.get("DJANGO_ADMIN_EMAIL", ""),
            is_staff=True,
            label="Admin",
        )
        self.ensure_user(
            username=os.environ.get("DJANGO_WORKER_USERNAME"),
            password=os.environ.get("DJANGO_WORKER_PASSWORD"),
            email=os.environ.get("DJANGO_WORKER_EMAIL", ""),
            is_staff=False,
            label="Worker",
        )

    def ensure_user(self, username, password, email, is_staff, label):
        if not username or not password:
            self.stdout.write(f"{label} username or password is not set; skipping.")
            return

        User = get_user_model()
        user, created = User.objects.get_or_create(username=username, defaults={"email": email})
        user.email = email
        user.is_staff = is_staff
        user.is_superuser = is_staff
        user.set_password(password)
        user.save()

        status = "created" if created else "updated"
        self.stdout.write(self.style.SUCCESS(f"{label} user {username!r} {status}."))
