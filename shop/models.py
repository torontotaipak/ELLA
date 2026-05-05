from decimal import Decimal

from django.db import models


class Batch(models.Model):
    name = models.CharField(max_length=160)
    pack_cost = models.DecimalField(max_digits=12, decimal_places=2)
    pack_quantity = models.PositiveIntegerField()
    dead_on_arrival = models.PositiveIntegerField(default=0)
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    retail_price = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    @property
    def stock_cost(self):
        return self.unit_cost * Decimal(self.quantity)

    def __str__(self):
        return f"{self.name} ({self.quantity})"


class Sale(models.Model):
    name = models.CharField(max_length=160)
    quantity = models.PositiveIntegerField()
    revenue = models.DecimalField(max_digits=12, decimal_places=2)
    cost = models.DecimalField(max_digits=12, decimal_places=2)
    profit = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.name}: {self.quantity}"


class SaleLine(models.Model):
    sale = models.ForeignKey(Sale, related_name="lines", on_delete=models.CASCADE)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)


class WriteOff(models.Model):
    name = models.CharField(max_length=160)
    quantity = models.PositiveIntegerField()
    cost = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=220, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.name}: {self.quantity}"


class WriteOffLine(models.Model):
    writeoff = models.ForeignKey(WriteOff, related_name="lines", on_delete=models.CASCADE)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
