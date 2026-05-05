from django.contrib.auth import views as auth_views
from django.urls import path

from . import views


urlpatterns = [
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("", views.index, name="index"),
    path("api/state/", views.state, name="api-state"),
    path("api/purchases/", views.create_purchase, name="api-create-purchase"),
    path("api/batches/", views.create_batch, name="api-create-batch"),
    path("api/batches/<int:batch_id>/", views.delete_batch, name="api-delete-batch"),
    path("api/batches/<int:batch_id>/quick-writeoff/", views.quick_writeoff, name="api-quick-writeoff"),
    path("api/sales/", views.create_sale, name="api-create-sale"),
    path("api/writeoffs/", views.create_writeoff, name="api-create-writeoff"),
    path("api/clear/", views.clear_data, name="api-clear"),
]
