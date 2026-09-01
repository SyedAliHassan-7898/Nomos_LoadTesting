/**
 * Tenant Admin setup flow captured from script.admin-flow more-dev.weuno.co.har.
 * The flow intentionally keeps IDs response-driven so every run can create
 * its own role, organization, badge, and banner without hardcoded fixtures.
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { ENV } from '../config/environment.js';
import { apiGet, apiPost, apiPatch, safeJson } from '../lib/http-client.js';
import {
  expectStatus,
  expectSuccessTrue,
  expectNeverServerError,
  expectCondition,
} from '../lib/assertions.js';

const BASE_ORIGIN = 'nomos.io';
const ROLE_LIST_PATH = '/api/Admin/roles/fetch-all?page=1&limit=10';
const PERMISSIONS_PATH = '/api/admin/permissions';
const ROLE_CREATE_PATH = '/api/Admin/roles/add-role';
const ROLE_ASSIGN_PATH = (roleId) => `/api/Admin/roles/assign-permissions-role/${roleId}`;
const ORGANIZATIONS_PATH = '/api/admin/organizations';
const ORGANIZATIONS_LIST_PATH = `${ORGANIZATIONS_PATH}?page=1&limit=10&isActive=true`;
const CHILD_ROLES_PATH = '/api/Admin/roles/fetch-all?page=1&limit=10&isActive=true&childAssignableOnly=true';
const ORGANIZATION_UPLOAD_PATH = '/api/files-upload/client-portal';
const BADGES_LIST_PATH = '/api/admin/badges/fetch-all?page=1&limit=10&isActive=true';
const BADGE_CREATE_PATH = '/api/admin/badges/add-badge';
const BANNER_UPLOAD_PATH = '/api/files-upload/banners';
const BANNER_CREATE_PATH = '/api/admin/banners';
const NEWS_CATEGORY_MODULE_ID = '62418b65-6f03-4770-8bc7-88be73f82d61';
const NEWS_MODULE_PATH = `/api/category/module/${NEWS_CATEGORY_MODULE_ID}`;

const ORGANIZATION_IMAGE = open(`../${ENV.ASSETS.feedImage}`, 'b');
const BANNER_DESKTOP_IMAGE = open(`../${ENV.ASSETS.courseModuleThumb}`, 'b');
const BANNER_MOBILE_IMAGE = open(`../${ENV.ASSETS.feedImage}`, 'b');

function adminHeaders(token, multipart = false) {
  const portalOrigin = ENV.CLIENT_PORTAL_ORIGIN;
  const originHost = portalOrigin.replace(/^https?:\/\//, '').split('/')[0].split('.')[0];
  const headers = {
    'x-base-origin': BASE_ORIGIN,
    Origin: portalOrigin,
    Referer: `${portalOrigin}/`,
    'x-origin': originHost,
    'x-module-key': 'news',
    'x-portal-type': 'web3',
    'x-timezone': 'Asia/Karachi',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (multipart) headers['x-module-key'] = 'news';
  return headers;
}

function rootData(body) {
  return body && body.data ? body.data : body || {};
}

function responseId(body, keys) {
  const wanted = new Set(keys);
  function find(value) {
    if (!value || typeof value !== 'object') return '';
    if (value.id && (value.name || value.role || value.organization || value.badge || value.permissions)) return value.id;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = find(item);
        if (found) return found;
      }
      return '';
    }
    for (const key of Object.keys(value)) {
      if (wanted.has(key) && value[key] && value[key].id) return value[key].id;
      const found = find(value[key]);
      if (found) return found;
    }
    return '';
  }
  return find(body);
}

function responseFiles(body) {
  const root = rootData(body);
  return Array.isArray(root.files) ? root.files : [];
}

function uploadFile(path, bytes, fileName, token, label) {
  const res = apiPost(path, { files: http.file(bytes, fileName) }, null, {
    isMultipart: true,
    params: { headers: adminHeaders(token, true) },
    tags: { endpoint: 'admin_file_upload', scenario: 'admin_flow', case: label },
  });
  console.log(`[Admin Flow] ${label} upload status: ${res.status}`);
  expectStatus(res, [200, 201], `admin_flow/${label}_upload`);
  expectSuccessTrue(res, `admin_flow/${label}_upload`);
  expectNeverServerError(res, `admin_flow/${label}_upload`);
  const key = responseFiles(safeJson(res))[0] || '';
  expectCondition(Boolean(key), `admin_flow/${label}_upload: file key returned`);
  return key;
}

export function createRoleFlow(token, suffix) {
  const initialRolesRes = apiGet(ROLE_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_roles', scenario: 'admin_flow', case: 'before_create' },
  });
  expectStatus(initialRolesRes, [200], 'admin_flow/list_roles_before');
  expectNeverServerError(initialRolesRes, 'admin_flow/list_roles_before');

  const permissionsRes = apiGet(PERMISSIONS_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'get_permissions', scenario: 'admin_flow' },
  });
  expectStatus(permissionsRes, [200], 'admin_flow/permissions');
  expectSuccessTrue(permissionsRes, 'admin_flow/permissions');
  expectNeverServerError(permissionsRes, 'admin_flow/permissions');

  const permissionGroups = rootData(safeJson(permissionsRes)).permissions || {};
  const permissionIds = [];
  Object.keys(permissionGroups).forEach((group) => {
    const value = permissionGroups[group] || {};
    (value.modulePermissions || []).forEach((permission) => {
      if (permission.id) permissionIds.push(permission.id);
    });
    (value.categories || []).forEach((permission) => {
      if (permission.id) permissionIds.push(permission.id);
    });
  });

  const roleRes = apiPost(ROLE_CREATE_PATH, { name: `Automated User ${suffix}` }, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'create_role', scenario: 'admin_flow' },
  });
  console.log(`[Admin Flow] Create role response status: ${roleRes.status}`);
  expectStatus(roleRes, [201], 'admin_flow/create_role');
  expectSuccessTrue(roleRes, 'admin_flow/create_role');
  expectNeverServerError(roleRes, 'admin_flow/create_role');
  const roleId = responseId(safeJson(roleRes), ['role']);
  expectCondition(Boolean(roleId), 'admin_flow/create_role: role id returned');
  if (!roleId) return '';

  const createdRolesRes = apiGet(ROLE_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_roles', scenario: 'admin_flow', case: 'after_create' },
  });
  expectStatus(createdRolesRes, [200], 'admin_flow/list_roles_after_create');
  expectNeverServerError(createdRolesRes, 'admin_flow/list_roles_after_create');

  const assignRes = apiPatch(ROLE_ASSIGN_PATH(roleId), { permissions: permissionIds }, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'assign_role_permissions', scenario: 'admin_flow' },
  });
  expectStatus(assignRes, [200], 'admin_flow/assign_role_permissions');
  expectSuccessTrue(assignRes, 'admin_flow/assign_role_permissions');
  expectNeverServerError(assignRes, 'admin_flow/assign_role_permissions');

  const assignedRolesRes = apiGet(ROLE_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_roles', scenario: 'admin_flow', case: 'after_permissions' },
  });
  expectStatus(assignedRolesRes, [200], 'admin_flow/list_roles_after_permissions');
  expectNeverServerError(assignedRolesRes, 'admin_flow/list_roles_after_permissions');
  return roleId;
}

export function createOrganizationFlow(token, roleId, suffix) {
  const listRes = apiGet(ORGANIZATIONS_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_organizations', scenario: 'admin_flow' },
  });
  expectStatus(listRes, [200], 'admin_flow/list_organizations');
  expectNeverServerError(listRes, 'admin_flow/list_organizations');

  const childRolesRes = apiGet(CHILD_ROLES_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_child_roles', scenario: 'admin_flow' },
  });
  expectStatus(childRolesRes, [200], 'admin_flow/list_child_roles');
  expectNeverServerError(childRolesRes, 'admin_flow/list_child_roles');

  const profileKey = uploadFile(
    ORGANIZATION_UPLOAD_PATH,
    ORGANIZATION_IMAGE,
    `organization-${suffix}.jpg`,
    token,
    'organization_profile'
  );
  const emailDomain = `nomos-loadtest-${suffix}.test`;
  const payload = {
    templateRoleIds: [roleId],
    emailDomain,
    customer: {
      country: 'Pakistan',
      email: `automateduser@${emailDomain}`,
      username: `Testing${suffix}`,
      firstName: 'Organization',
      lastName: 'QA Script',
      profilePicture: profileKey,
    },
    domain: {
      portalName: `Automated ${suffix}`,
      collectionId: '',
      appId: '',
      appSecret: '',
      customDomainId: '',
    },
    customerFacingPolicy: '<p>tester</p>',
    operationalPolicy: '<p>tester</p>',
    permissionConfig: {
      inactivityWarningDays: 11,
      inactivityLockDays: 1,
      dataRetentionDays: 2,
      deletionMode: 'HARD_DELETE',
    },
  };
  const createRes = apiPost(ORGANIZATIONS_PATH, payload, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'create_organization', scenario: 'admin_flow' },
  });
  expectStatus(createRes, [201], 'admin_flow/create_organization');
  expectSuccessTrue(createRes, 'admin_flow/create_organization');
  expectNeverServerError(createRes, 'admin_flow/create_organization');
  const organization = rootData(safeJson(createRes)).organization || {};
  const organizationId = organization.childTenant && organization.childTenant.id;
  expectCondition(Boolean(organizationId), 'admin_flow/create_organization: organization id returned');
  return organizationId || '';
}

function createBadge(token, organizationId, suffix) {
  const beforeRes = apiGet(BADGES_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_badges', scenario: 'admin_flow', case: 'before_create' },
  });
  expectStatus(beforeRes, [200], 'admin_flow/list_badges_before');
  expectNeverServerError(beforeRes, 'admin_flow/list_badges_before');

  const orgRes = apiGet(ORGANIZATIONS_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_organizations', scenario: 'admin_flow', case: 'before_badge' },
  });
  expectStatus(orgRes, [200], 'admin_flow/list_organizations_before_badge');
  expectNeverServerError(orgRes, 'admin_flow/list_organizations_before_badge');

  const badgeRes = apiPost(BADGE_CREATE_PATH, {
    name: `Tester ${suffix}`,
    organizationIds: [organizationId],
  }, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'create_badge', scenario: 'admin_flow' },
  });
  expectStatus(badgeRes, [201], 'admin_flow/create_badge');
  expectSuccessTrue(badgeRes, 'admin_flow/create_badge');
  expectNeverServerError(badgeRes, 'admin_flow/create_badge');

  const afterRes = apiGet(BADGES_LIST_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'list_badges', scenario: 'admin_flow', case: 'after_create' },
  });
  expectStatus(afterRes, [200], 'admin_flow/list_badges_after');
  expectNeverServerError(afterRes, 'admin_flow/list_badges_after');
}

function createBanner(token, suffix) {
  const moduleRes = apiGet(NEWS_MODULE_PATH, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'get_news_module', scenario: 'admin_flow' },
  });
  console.log(`[Admin Flow] News module response status: ${moduleRes.status}`);
  expectStatus(moduleRes, [200], 'admin_flow/news_module');
  expectNeverServerError(moduleRes, 'admin_flow/news_module');
  const categories = rootData(safeJson(moduleRes)).categories || [];
  const newsModuleId = categories[0] && categories[0].module && categories[0].module.customModule && categories[0].module.customModule.id;
  expectCondition(Boolean(newsModuleId), 'admin_flow/news_module: custom module id returned');
  if (!newsModuleId) return;

  const desktopKey = uploadFile(BANNER_UPLOAD_PATH, BANNER_DESKTOP_IMAGE, `banner-${suffix}.jpg`, token, 'banner_desktop');
  const mobileKey = uploadFile(BANNER_UPLOAD_PATH, BANNER_MOBILE_IMAGE, `banner-mobile-${suffix}.jpg`, token, 'banner_mobile');
  const bannerRes = apiPost(BANNER_CREATE_PATH, {
    imageUrl: desktopKey,
    imageUrlMobile: mobileKey,
    hyperlink: '',
    bannerType: 'regular',
    moduleId: newsModuleId,
    moduleType: 'news',
  }, token, {
    params: { headers: adminHeaders(token) },
    tags: { endpoint: 'create_banner', scenario: 'admin_flow' },
  });
  expectStatus(bannerRes, [201], 'admin_flow/create_banner');
  expectSuccessTrue(bannerRes, 'admin_flow/create_banner');
  expectNeverServerError(bannerRes, 'admin_flow/create_banner');
}

export function runAdminFlow(token, vu = 0, iter = 0) {
  console.log('--- [Admin Flow] Starting role, organization, badge, and banner flow ---');
  const suffix = `${vu}-${iter}-${Date.now()}`;
  const roleId = createRoleFlow(token, suffix);
  console.log(`[Admin Flow] Role created and permissions assigned: ${Boolean(roleId)}`);
  if (roleId) {
    const organizationId = createOrganizationFlow(token, roleId, suffix);
    console.log(`[Admin Flow] Organization created: ${Boolean(organizationId)}`);
    if (organizationId) {
      createBadge(token, organizationId, suffix);
      console.log('[Admin Flow] Badge created and attached to organization.');
    }
  }
  createBanner(token, suffix);
  console.log('[Admin Flow] News banner flow completed.');
  sleep(0.2);
  console.log('--- [Admin Flow] Finished role, organization, badge, and banner flow ---');
}
