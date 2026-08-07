PERMISSION_CATALOG = [
    "dashboard.view",
    "company.view",
    "company.manage",
    "employees.view",
    "employees.manage",
    "employees.invite",
    "departments.manage",
    "designations.manage",
    "roles.view",
    "roles.manage",
    "activity_logs.view",
    "crm.view",
    "crm.manage",
    "clients.view",
    "clients.manage",
    "orders.view",
    "orders.manage",
    "projects.view",
    "projects.manage",
    "finance.view",
    "finance.manage",
    "reports.view",
    "settings.manage",
]

ADMIN_PERMISSIONS = ["*"]
USER_PERMISSIONS = ["dashboard.view"]


def permission_is_valid(permission: str) -> bool:
    return permission in PERMISSION_CATALOG
