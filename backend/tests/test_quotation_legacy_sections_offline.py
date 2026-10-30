"""Actual V2 replacement service with isolated SQLite persistence; no network/production data."""
from datetime import date
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.sales import Quotation, QuotationSection
from app.schemas.quotation_v2 import QuotationSectionInput
from app.services.quotation_v2 import replace_sections
from test_hr_document_upload_commit_safety_offline import FixtureCompiler


def section(kind, content=" ", visible=True, order=0):
    return QuotationSectionInput(section_type=kind, content=content, is_visible=visible, sort_order=order)


class LegacySectionPersistenceTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.socket.connect_ex', 'socket.create_connection', 'socket.getaddrinfo'):
            self.enterContext(patch(target, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (Quotation, QuotationSection):
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Quotation.__table__.insert(), dict(id='quote', organization_id='org', quotation_number='Q-SYN', client_id='client', created_by_user_id='actor', status='draft', issue_date=date(2096,1,1), currency='USD', seller_name_snapshot='Synthetic seller', client_name_snapshot='Synthetic client', subtotal=0, total=0))

    def seed(self, notes, terms):
        with Session(self.engine) as db:
            q=db.get(Quotation,'quote');q.notes=notes;q.terms_conditions=terms;db.commit()

    def replace(self, rows):
        with Session(self.engine) as db:
            replace_sections(db, db.get(Quotation,'quote'), rows);db.commit()
        with Session(self.engine) as db:
            q=db.get(Quotation,'quote')
            return q.notes,q.terms_conditions

    def test_legacy_only_and_default_empty_sections_survive_repeated_saves(self):
        for text in (None, '', 'Legacy note — বাংলা\nSecond line', '  Untrimmed legacy  '):
            with self.subTest(text=text):
                self.seed(text,text)
                self.assertEqual(self.replace([]),(text,text))
                self.assertEqual(self.replace([section('terms_conditions'),section('additional_notes')]),(text,text))
                self.assertEqual(self.replace([section('terms_conditions'),section('additional_notes')]),(text,text))

    def test_legacy_core_edit_survives_unchanged_populated_v2(self):
        rows=[section('additional_notes','V2 note'),section('terms_conditions','V2 terms')]
        self.replace(rows);self.seed('Legacy update','Legacy terms update')
        self.assertEqual(self.replace(rows),('Legacy update','Legacy terms update'))

    def test_independent_edit_updates_only_changed_projection(self):
        rows=[section('additional_notes','Note'),section('terms_conditions','Terms')]
        self.replace(rows);self.seed('Independently stored note','Terms')
        self.assertEqual(self.replace([rows[0],section('terms_conditions','Edited terms')]),('Independently stored note','Edited terms'))

    def test_populated_v2_explicit_clear_removal_and_hide_still_clear(self):
        for kind in ('additional_notes','terms_conditions'):
            for replacement in ([],[section(kind,' ')],[section(kind,'Populated',False)]):
                with self.subTest(kind=kind,replacement=replacement):
                    self.replace([section(kind,'Populated')])
                    result=self.replace(replacement)
                    self.assertIsNone(result[0 if kind=='additional_notes' else 1])

    def test_order_visibility_and_new_content_are_projected(self):
        self.seed('Legacy','Legacy terms')
        result=self.replace([section('additional_notes','Second',order=20),section('additional_notes','First',order=10),section('additional_notes','Hidden',False,0),section('terms_conditions','New terms')])
        self.assertEqual(result,('First\n\nSecond','New terms'))
        self.assertEqual(self.replace([section('additional_notes','First',order=20),section('additional_notes','Second',order=10),section('terms_conditions','New terms')]),('Second\n\nFirst','New terms'))

if __name__=='__main__': unittest.main()
