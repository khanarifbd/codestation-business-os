"""Real Pydantic inventory boundaries; no stock writes or database integration."""
from decimal import Decimal
import unittest

from pydantic import ValidationError

from app.core.localization import ISO_COUNTRY_CODES, ISO_CURRENCY_CODES
from app.schemas.inventory import CategoryCreate, WarehouseCreate, ProductCreate
from app.schemas.inventory_management import (
    CategoryUpdate, WarehouseUpdate, ProductUpdate, SupplierCreate, SupplierUpdate,
)


class InventorySchemaValidation(unittest.TestCase):
    def test_required_create_text_rejects_blank_and_null(self):
        cases = [(CategoryCreate, {'name':'Valid'}, ['name']),
                 (WarehouseCreate, {'name':'Valid','code':'MAIN'}, ['name','code']),
                 (ProductCreate, {'name':'Valid','sku':'SKU','unit':'unit','currency':'GBP'}, ['name','sku','unit','currency']),
                 (SupplierCreate, {'name':'Valid'}, ['name'])]
        for model, valid, fields in cases:
            for field in fields:
                for value in (None, '', '   ', '\u00a0\t'):
                    with self.subTest(model=model.__name__,field=field,value=value), self.assertRaises(ValidationError):
                        model(**{**valid, field:value})

    def test_unicode_internal_spaces_and_trim_before_length(self):
        for name in ('José O’Connor', '株式会社', 'মোঃ আরিফ', 'Müller  GmbH'):
            for model in (CategoryCreate, SupplierCreate, CategoryUpdate, SupplierUpdate):
                self.assertEqual(model(name=f'  {name}\u00a0').name,name)
        self.assertEqual(CategoryCreate(name=' '+('x'*160)+' ').name,'x'*160)
        with self.assertRaises(ValidationError): CategoryCreate(name='x'*161)
        product=ProductCreate(name=' 产品 ',sku=' SKU  01 ',unit=' কেজি ',currency=' gbp ')
        self.assertEqual((product.name,product.sku,product.unit,product.currency),('产品','SKU  01','কেজি','GBP'))
        warehouse=WarehouseCreate(name=' London ',code=' MAIN ')
        self.assertEqual((warehouse.name,warehouse.code),('London','MAIN'))

    def test_required_patch_null_rejected_and_omission_preserved(self):
        cases={CategoryUpdate:['name','is_active'],WarehouseUpdate:['name','code','is_default','is_active'],
               ProductUpdate:['name','sku','unit','currency','item_type','selling_price','standard_cost','reorder_level','track_inventory','allow_negative_stock','is_active'],
               SupplierUpdate:['name','is_active']}
        for model, fields in cases.items():
            self.assertEqual(model().model_dump(exclude_unset=True),{})
            for field in fields:
                with self.subTest(model=model.__name__,field=field), self.assertRaises(ValidationError): model(**{field:None})
        for model, fields in [(CategoryUpdate,['name']),(WarehouseUpdate,['name','code']),
                              (ProductUpdate,['name','sku','unit','currency']),(SupplierUpdate,['name'])]:
            for field in fields:
                with self.subTest(model=model.__name__,field=field), self.assertRaises(ValidationError): model(**{field:' \u00a0 '})

    def test_optional_patch_nulls_remain_explicit_clears(self):
        for model, fields in [(CategoryUpdate,['description']),(WarehouseUpdate,['address']),
                              (ProductUpdate,['barcode','description','category_id','tax_code_id']),
                              (SupplierUpdate,['contact_name','email','phone','website','tax_identifier','country_code','currency','notes'])]:
            payload=dict.fromkeys(fields)
            self.assertEqual(model(**payload).model_dump(exclude_unset=True),payload)
        self.assertEqual(CategoryUpdate(is_active=False).model_dump(exclude_unset=True),{'is_active':False})

    def test_supplier_iso_normalization_and_optional_clear(self):
        for model in (SupplierCreate,SupplierUpdate):
            payload=model(name='Supplier',country_code=' gb ',currency=' gbp ')
            self.assertEqual((payload.country_code,payload.currency),('GB','GBP'))
            for field, value in [('country_code','ZZ'),('currency','QQQ'),('country_code',' '),('currency',' ')]:
                with self.subTest(model=model.__name__,field=field,value=value), self.assertRaises(ValidationError):
                    model(name='Supplier',**{field:value})
            payload=model(name='Supplier',country_code=None,currency=None)
            self.assertIsNone(payload.country_code); self.assertIsNone(payload.currency)
        supplier=SupplierCreate(name='Müller',phone='+44 20 7946 0958 ext 2',notes='ঢাকা')
        self.assertEqual(supplier.phone,'+44 20 7946 0958 ext 2'); self.assertEqual(supplier.notes,'ঢাকা')

    def test_all_existing_supported_supplier_codes_remain_accepted(self):
        for code in ISO_COUNTRY_CODES:
            self.assertEqual(SupplierUpdate(country_code=code.lower()).country_code,code)
        for code in ISO_CURRENCY_CODES:
            self.assertEqual(SupplierUpdate(currency=code.lower()).currency,code)

    def test_decimal_precision_and_tracking_contract_unchanged(self):
        values={'selling_price':'12345678901234.1234','standard_cost':'0.00005','reorder_level':'1.23456'}
        for model, base in [(ProductCreate,{'name':'Product','sku':'SKU','currency':'GBP'}),(ProductUpdate,{})]:
            value=model(**base,**values)
            for field, text in values.items(): self.assertEqual(getattr(value,field),Decimal(text))
            with self.assertRaises(ValidationError): model(**base,selling_price='-1')
        self.assertTrue(ProductCreate(name='Product',sku='SKU',currency='GBP',track_inventory=None).track_inventory)
        for model, base in [(ProductCreate,{'name':'Service','sku':'SKU','currency':'GBP'}),(ProductUpdate,{})]:
            value=model(**base,item_type='service',reorder_level='2',allow_negative_stock=True)
            self.assertFalse(value.track_inventory); self.assertFalse(value.allow_negative_stock)
            self.assertEqual(value.reorder_level,Decimal('0'))
            with self.assertRaises(ValidationError): model(**base,item_type='stock_item',track_inventory=False)


if __name__ == '__main__': unittest.main()
