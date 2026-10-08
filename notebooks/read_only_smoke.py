# Databricks notebook source
# Read-only DAB smoke test. No table writes or outreach.
dbutils.widgets.text('catalog','workspace')
dbutils.widgets.text('schema','chiro_hackathon')
catalog=dbutils.widgets.get('catalog')
schema=dbutils.widgets.get('schema')
import re
assert all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',x) for x in (catalog,schema))
for table in ('patients','appointments','visits','providers','locations','leads','referrals','marketing_campaigns'):
    data=spark.table(f'{catalog}.{schema}.{table}')
    print(table, data.schema.simpleString())
    display(data.limit(2))
