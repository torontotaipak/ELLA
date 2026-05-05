from django.contrib import admin

from .models import Batch, Sale, SaleLine, WriteOff, WriteOffLine


class SaleLineInline(admin.TabularInline):
    model = SaleLine
    extra = 0
    readonly_fields = ("batch", "quantity", "unit_cost", "unit_price")
    can_delete = False


class WriteOffLineInline(admin.TabularInline):
    model = WriteOffLine
    extra = 0
    readonly_fields = ("batch", "quantity", "unit_cost")
    can_delete = False


@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ("name", "quantity", "pack_cost", "pack_quantity", "dead_on_arrival", "unit_cost", "retail_price", "created_at")
    search_fields = ("name",)
    list_filter = ("created_at",)


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("name", "quantity", "revenue", "cost", "profit", "created_at")
    search_fields = ("name",)
    list_filter = ("created_at",)
    inlines = [SaleLineInline]


@admin.register(WriteOff)
class WriteOffAdmin(admin.ModelAdmin):
    list_display = ("name", "quantity", "cost", "reason", "created_at")
    search_fields = ("name", "reason")
    list_filter = ("created_at",)
    inlines = [WriteOffLineInline]
