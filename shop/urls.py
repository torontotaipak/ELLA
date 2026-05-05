from django.urls import path

from . import views


urlpatterns = [
    path("", views.index, name="index"),
    path("api/state/", views.state, name="api-state"),
    path("api/batches/", views.create_batch, name="api-create-batch"),
    path("api/batches/<int:batch_id>/", views.delete_batch, name="api-delete-batch"),
    path("api/batches/<int:batch_id>/quick-writeoff/", views.quick_writeoff, name="api-quick-writeoff"),
    path("api/sales/", views.create_sale, name="api-create-sale"),
    path("api/writeoffs/", views.create_writeoff, name="api-create-writeoff"),
    path("api/clear/", views.clear_data, name="api-clear"),
]
