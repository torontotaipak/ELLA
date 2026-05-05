import json
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Max, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods, require_POST
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Batch, Purchase, Sale, SaleLine, WriteOff, WriteOffLine


MONEY = Decimal("0.01")


def api_login_required(view_func):
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Нужно войти в аккаунт."}, status=401)
        return view_func(request, *args, **kwargs)

    return wrapped


def api_staff_required(view_func):
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Нужно войти в аккаунт."}, status=401)
        if not request.user.is_staff:
            return JsonResponse({"error": "Недостаточно прав."}, status=403)
        return view_func(request, *args, **kwargs)

    return wrapped


@ensure_csrf_cookie
@login_required
def index(request):
    return render(request, "shop/index.html")


@api_login_required
@require_http_methods(["GET"])
def state(request):
    return JsonResponse(build_state(request.user))


@api_staff_required
@require_POST
@transaction.atomic
def create_purchase(request):
    data = body_json(request)
    purchase = Purchase.objects.create(
        number=next_purchase_number(),
        note=clean_name(data.get("note")),
    )
    return JsonResponse({"purchase": purchase_json(purchase), "state": build_state(request.user)}, status=201)


@api_staff_required
@require_POST
@transaction.atomic
def create_batch(request):
    data = body_json(request)
    purchase_id = int_value(data.get("purchaseId"))
    purchase = Purchase.objects.filter(pk=purchase_id).first()
    if purchase is None:
        purchase = Purchase.objects.create(number=next_purchase_number())

    name = clean_name(data.get("name"))
    pack_cost = decimal_value(data.get("packCost"))
    pack_quantity = int_value(data.get("packQuantity"))
    dead_on_arrival = min(int_value(data.get("deadOnArrival")), pack_quantity)
    retail_price = decimal_value(data.get("retailPrice"))
    live_quantity = pack_quantity - dead_on_arrival

    if not name or pack_cost <= 0 or pack_quantity <= 0 or live_quantity <= 0 or retail_price <= 0:
        return JsonResponse({"error": "Проверьте данные пачки."}, status=400)

    unit_cost = pack_cost / Decimal(pack_quantity)
    batch = Batch.objects.create(
        purchase=purchase,
        name=name,
        pack_cost=pack_cost,
        pack_quantity=pack_quantity,
        dead_on_arrival=dead_on_arrival,
        quantity=live_quantity,
        unit_cost=unit_cost,
        retail_price=retail_price,
    )

    if dead_on_arrival > 0:
        WriteOff.objects.create(
            name=name,
            quantity=dead_on_arrival,
            cost=money(unit_cost * Decimal(dead_on_arrival)),
            reason="Мертвые сразу в пачке",
        )

    return JsonResponse({"batch": batch_json(batch), "state": build_state(request.user)}, status=201)


@api_staff_required
@require_http_methods(["DELETE"])
@transaction.atomic
def delete_batch(request, batch_id):
    batch = get_object_or_404(Batch.objects.select_for_update(), pk=batch_id)
    batch.quantity = 0
    batch.save(update_fields=["quantity"])
    return JsonResponse(build_state(request.user))


@api_staff_required
@require_POST
@transaction.atomic
def quick_writeoff(request, batch_id):
    batch = get_object_or_404(Batch.objects.select_for_update(), pk=batch_id)
    if batch.quantity <= 0:
        return JsonResponse({"error": "В этой пачке нет остатка."}, status=400)

    batch.quantity -= 1
    batch.save(update_fields=["quantity"])
    writeoff = WriteOff.objects.create(
        name=batch.name,
        quantity=1,
        cost=money(batch.unit_cost),
        reason="Быстрое списание со склада",
    )
    WriteOffLine.objects.create(writeoff=writeoff, batch=batch, quantity=1, unit_cost=batch.unit_cost)
    return JsonResponse({"writeoff": writeoff_json(writeoff, request.user), "state": build_state(request.user)})


@api_login_required
@require_POST
@transaction.atomic
def create_sale(request):
    data = body_json(request)
    sale_type = data.get("saleType") or Sale.SALE_SINGLE

    if sale_type == Sale.SALE_BOUQUET:
        return create_bouquet_sale(request, data)

    name = clean_name(data.get("name"))
    quantity = int_value(data.get("quantity"))
    custom_price = data.get("customPrice")
    custom_price = None if custom_price in ("", None) else decimal_value(custom_price)

    if not name or quantity <= 0:
        return JsonResponse({"error": "Проверьте данные продажи."}, status=400)
    if available(name) < quantity:
        return JsonResponse({"error": f"Недостаточно на складе: доступно {available(name)} шт."}, status=400)

    remaining = quantity
    cost_total = Decimal("0")
    revenue_total = Decimal("0")
    sale = Sale.objects.create(sale_type=Sale.SALE_SINGLE, name=name, quantity=quantity, revenue=0, cost=0, profit=0)

    for batch in fifo_batches(name):
        if remaining <= 0:
            break
        take = min(batch.quantity, remaining)
        price = custom_price if custom_price is not None else batch.retail_price
        batch.quantity -= take
        batch.save(update_fields=["quantity"])
        SaleLine.objects.create(sale=sale, batch=batch, quantity=take, unit_cost=batch.unit_cost, unit_price=price)
        cost_total += batch.unit_cost * Decimal(take)
        revenue_total += price * Decimal(take)
        remaining -= take

    sale.cost = money(cost_total)
    sale.revenue = money(revenue_total)
    sale.profit = money(revenue_total - cost_total)
    sale.save(update_fields=["cost", "revenue", "profit"])
    return JsonResponse({"sale": sale_json(sale, request.user), "state": build_state(request.user)}, status=201)


def create_bouquet_sale(request, data):
    bouquet_name = clean_name(data.get("bouquetName")) or "Букет"
    bouquet_price = decimal_value(data.get("bouquetPrice"))
    items = data.get("items") if isinstance(data.get("items"), list) else []
    composition = []

    for item in items:
        name = clean_name(item.get("name") if isinstance(item, dict) else "")
        quantity = int_value(item.get("quantity") if isinstance(item, dict) else 0)
        if name and quantity > 0:
            existing = next((row for row in composition if row["name"] == name), None)
            if existing:
                existing["quantity"] += quantity
            else:
                composition.append({"name": name, "quantity": quantity})

    if bouquet_price <= 0 or not composition:
        return JsonResponse({"error": "Укажите цену букета и его состав."}, status=400)

    for item in composition:
        if available(item["name"]) < item["quantity"]:
            return JsonResponse({"error": f"Недостаточно {item['name']}: доступно {available(item['name'])} шт."}, status=400)

    total_quantity = sum(item["quantity"] for item in composition)
    cost_total = Decimal("0")
    sale = Sale.objects.create(
        sale_type=Sale.SALE_BOUQUET,
        name=bouquet_name,
        quantity=total_quantity,
        revenue=money(bouquet_price),
        cost=0,
        profit=0,
    )

    for item in composition:
        remaining = item["quantity"]
        for batch in fifo_batches(item["name"]):
            if remaining <= 0:
                break
            take = min(batch.quantity, remaining)
            batch.quantity -= take
            batch.save(update_fields=["quantity"])
            SaleLine.objects.create(
                sale=sale,
                batch=batch,
                quantity=take,
                unit_cost=batch.unit_cost,
                unit_price=Decimal("0"),
            )
            cost_total += batch.unit_cost * Decimal(take)
            remaining -= take

    sale.cost = money(cost_total)
    sale.profit = money(bouquet_price - cost_total)
    sale.save(update_fields=["cost", "profit"])
    return JsonResponse({"sale": sale_json(sale, request.user), "state": build_state(request.user)}, status=201)


@api_login_required
@require_POST
@transaction.atomic
def create_writeoff(request):
    data = body_json(request)
    name = clean_name(data.get("name"))
    quantity = int_value(data.get("quantity"))
    reason = clean_name(data.get("reason")) or "Мертвые цветы"

    if not name or quantity <= 0:
        return JsonResponse({"error": "Проверьте данные списания."}, status=400)
    if available(name) < quantity:
        return JsonResponse({"error": f"Недостаточно на складе: доступно {available(name)} шт."}, status=400)

    remaining = quantity
    cost_total = Decimal("0")
    writeoff = WriteOff.objects.create(name=name, quantity=quantity, cost=0, reason=reason)

    for batch in fifo_batches(name):
        if remaining <= 0:
            break
        take = min(batch.quantity, remaining)
        batch.quantity -= take
        batch.save(update_fields=["quantity"])
        WriteOffLine.objects.create(writeoff=writeoff, batch=batch, quantity=take, unit_cost=batch.unit_cost)
        cost_total += batch.unit_cost * Decimal(take)
        remaining -= take

    writeoff.cost = money(cost_total)
    writeoff.save(update_fields=["cost"])
    return JsonResponse({"writeoff": writeoff_json(writeoff, request.user), "state": build_state(request.user)}, status=201)


@api_staff_required
@require_POST
@transaction.atomic
def clear_data(request):
    SaleLine.objects.all().delete()
    WriteOffLine.objects.all().delete()
    Sale.objects.all().delete()
    WriteOff.objects.all().delete()
    Batch.objects.all().delete()
    Purchase.objects.all().delete()
    return JsonResponse(build_state(request.user))


def build_state(user):
    can_manage = user.is_staff
    batches = list(Batch.objects.filter(quantity__gt=0))
    purchases = list(Purchase.objects.all()[:100])
    sales = list(Sale.objects.all()[:200])
    writeoffs = list(WriteOff.objects.all()[:200])
    total_units = sum(batch.quantity for batch in batches)
    stats = {"totalUnits": total_units}

    if can_manage:
        revenue = Sale.objects.aggregate(total=Sum("revenue"))["total"] or Decimal("0")
        sales_profit = Sale.objects.aggregate(total=Sum("profit"))["total"] or Decimal("0")
        dead_loss = WriteOff.objects.aggregate(total=Sum("cost"))["total"] or Decimal("0")
        stock_cost = sum((batch.stock_cost for batch in batches), Decimal("0"))
        stats.update({
            "stockCost": decimal_json(stock_cost),
            "revenue": decimal_json(revenue),
            "deadLoss": decimal_json(dead_loss),
            "profit": decimal_json(sales_profit - dead_loss),
        })

    return {
        "canManage": can_manage,
        "purchases": [purchase_json(purchase, can_manage) for purchase in purchases],
        "batches": [batch_json(batch, can_manage) for batch in batches],
        "sales": [sale_json(sale, user) for sale in sales],
        "writeoffs": [writeoff_json(item, user) for item in writeoffs],
        "stats": stats,
    }


def purchase_json(purchase, can_manage=True):
    batches = list(purchase.batches.filter(quantity__gt=0))
    data = {
        "id": purchase.id,
        "number": purchase.number,
        "note": purchase.note,
        "createdAt": purchase.created_at.isoformat(),
        "remainingQuantity": sum(batch.quantity for batch in batches),
    }
    if can_manage:
        data["stockCost"] = decimal_json(sum((batch.stock_cost for batch in batches), Decimal("0")))
    return data


def batch_json(batch, can_manage=True):
    data = {
        "id": batch.id,
        "purchaseId": batch.purchase_id,
        "purchaseNumber": batch.purchase.number if batch.purchase else None,
        "name": batch.name,
        "quantity": batch.quantity,
        "createdAt": batch.created_at.isoformat(),
    }
    if can_manage:
        data.update({
            "packCost": decimal_json(batch.pack_cost),
            "packQuantity": batch.pack_quantity,
            "deadOnArrival": batch.dead_on_arrival,
            "cost": decimal_json(batch.unit_cost),
            "retailPrice": decimal_json(batch.retail_price),
        })
    return data


def sale_json(sale, user):
    data = {
        "id": sale.id,
        "saleType": sale.sale_type,
        "name": sale.name,
        "quantity": sale.quantity,
        "createdAt": sale.created_at.isoformat(),
    }
    if user.is_staff:
        data.update({
            "revenue": decimal_json(sale.revenue),
            "cost": decimal_json(sale.cost),
            "profit": decimal_json(sale.profit),
        })
    return data


def writeoff_json(writeoff, user):
    data = {
        "id": writeoff.id,
        "name": writeoff.name,
        "quantity": writeoff.quantity,
        "reason": writeoff.reason,
        "createdAt": writeoff.created_at.isoformat(),
    }
    if user.is_staff:
        data["cost"] = decimal_json(writeoff.cost)
    return data


def fifo_batches(name):
    return Batch.objects.select_for_update().filter(name=name, quantity__gt=0).order_by("created_at", "id")


def available(name):
    return Batch.objects.filter(name=name).aggregate(total=Sum("quantity"))["total"] or 0


def next_purchase_number():
    max_number = Purchase.objects.aggregate(max_number=Max("number"))["max_number"] or 0
    return max_number + 1


def body_json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return {}


def clean_name(value):
    return " ".join(str(value or "").strip().split())


def int_value(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def decimal_value(value):
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def money(value):
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def decimal_json(value):
    return float(Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP))
