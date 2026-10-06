export const TENANT_ROLES = ['Admin', 'StoreKeeper'];

export const PERMISSIONS = [
  { key: 'dashboard.view', group: 'Dashboard', label: 'View dashboard' },
  { key: 'tenants.view', group: 'Tenants', label: 'View tenants' },
  { key: 'tenants.create', group: 'Tenants', label: 'Create tenants' },
  { key: 'tenants.update', group: 'Tenants', label: 'Edit tenants' },
  { key: 'tenants.status', group: 'Tenants', label: 'Activate or deactivate tenants' },
  { key: 'tenantAdmins.view', group: 'Tenant admins', label: 'View tenant admins' },
  { key: 'tenantAdmins.create', group: 'Tenant admins', label: 'Create tenant admins' },
  { key: 'tenantAdmins.update', group: 'Tenant admins', label: 'Edit tenant admins' },
  { key: 'tenantAdmins.status', group: 'Tenant admins', label: 'Activate or deactivate tenant admins' },
  { key: 'outlets.view', group: 'Outlets', label: 'View outlets' },
  { key: 'whatsapp.onboard', group: 'WhatsApp', label: 'Trigger WhatsApp onboarding' },
  { key: 'users.view', group: 'Platform users', label: 'View platform users' },
  { key: 'settings.view', group: 'Settings', label: 'View settings' },
];

const ALL = PERMISSIONS.map((item) => item.key);

export const ROLE_PERMISSIONS = {
  Admin: ALL.filter((key) => !key.startsWith('users.') && key !== 'settings.view'),
  StoreKeeper: ['dashboard.view', 'tenants.view', 'tenantAdmins.view', 'outlets.view'],
};

export function permissionCatalog() {
  return {
    roles: TENANT_ROLES,
    permissions: PERMISSIONS,
    grants: ROLE_PERMISSIONS,
  };
}
