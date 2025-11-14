'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { groupPermissionsByResource } from '@/utils/rbac';
import {
  CameraIcon,
  CheckCircleIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const initialProfileForm = {
  full_name: '',
  email: ''
};

const initialEmployeeForm = {
  phone: '',
  mobile: '',
  personal_email: '',
  present_address: '',
  city: '',
  state: '',
  country: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  profile_photo_url: ''
};

const initialPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

function toTitle(value) {
  if (!value) return '';
  return value
    .replace(/[_:-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function SettingsPage() {
  const { user: sessionUser } = useSessionRBAC();
  const [settingsData, setSettingsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [employeeForm, setEmployeeForm] = useState(initialEmployeeForm);
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimeout = useRef(null);

  const showToast = (type, message) => {
    if (toastTimeout.current) {
      clearTimeout(toastTimeout.current);
    }
    setToast({ type, message });
    toastTimeout.current = setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => () => {
    if (toastTimeout.current) {
      clearTimeout(toastTimeout.current);
    }
  }, []);

  const syncFromPayload = (payload) => {
    if (!payload?.user) return;
    setSettingsData(payload);
    setProfileForm({
      full_name: payload.user.full_name || '',
      email: payload.user.email || ''
    });
    const employee = payload.user.employee || {};
    setEmployeeForm({
      phone: employee.phone || '',
      mobile: employee.mobile || '',
      personal_email: employee.personal_email || '',
      present_address: employee.present_address || '',
      city: employee.city || '',
      state: employee.state || '',
      country: employee.country || '',
      emergency_contact_name: employee.emergency_contact_name || '',
      emergency_contact_phone: employee.emergency_contact_phone || '',
      profile_photo_url: employee.profile_photo_url || ''
    });
  };

  const fetchProfile = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/settings/profile', { cache: 'no-store', credentials: 'include' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load profile');
      }
      syncFromPayload(json.data);
    } catch (error) {
      showToast('error', error.message || 'Unable to load settings');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateSettings = async (payload, successMessage) => {
    const res = await fetch('/api/settings/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to update settings');
    }
    syncFromPayload(json.data);
    if (successMessage) {
      showToast('success', successMessage);
    }
  };

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await updateSettings({ profile: profileForm }, 'Profile details updated');
    } catch (error) {
      showToast('error', error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleContactSubmit = async (event) => {
    event.preventDefault();
    setSavingContact(true);
    try {
      await updateSettings({ employee: employeeForm }, 'Contact preferences saved');
    } catch (error) {
      showToast('error', error.message);
    } finally {
      setSavingContact(false);
    }
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('error', 'New passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        }),
        credentials: 'include'
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to update password');
      }
      showToast('success', 'Password updated');
      setPasswordForm(initialPasswordForm);
      await fetchProfile({ silent: true });
    } catch (error) {
      showToast('error', error.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!settingsData?.user?.employee?.id) {
      showToast('error', 'Link your employee profile before uploading a photo.');
      event.target.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Please select a valid image file');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'Image must be smaller than 5 MB');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      setAvatarUploading(true);
      try {
        const uploadRes = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, b64: reader.result }),
          credentials: 'include'
        });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok || !uploadJson.success) {
          throw new Error(uploadJson.error || 'Failed to upload image');
        }
        const photoUrl = uploadJson.data?.fileUrl;
        if (photoUrl) {
          await updateSettings({ employee: { profile_photo_url: photoUrl } }, 'Profile photo updated');
        }
      } catch (error) {
        showToast('error', error.message);
      } finally {
        setAvatarUploading(false);
        event.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const mergedPermissions = useMemo(() => {
    if (!settingsData?.permissions) return [];
    const { merged = [], role = [], user = [] } = settingsData.permissions;
    return Array.from(new Set([...merged, ...role, ...user]));
  }, [settingsData]);

  const permissionGroups = useMemo(() => {
    if (!mergedPermissions.length) return {};
    const grouped = groupPermissionsByResource(mergedPermissions);
    return Object.fromEntries(
      Object.entries(grouped).map(([resource, perms]) => [resource, Array.from(new Set(perms))])
    );
  }, [mergedPermissions]);

  const userSummary = settingsData?.user;
  const employeeSummary = userSummary?.employee;
  const avatarUrl = employeeSummary?.profile_photo_url || employeeForm.profile_photo_url;
  const displayName = userSummary?.full_name || userSummary?.username || sessionUser?.username || 'Account';
  const initials = useMemo(() => {
    return displayName
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2) || 'A';
  }, [displayName]);
  const hasEmployee = Boolean(employeeSummary?.id);
  const isSuperAdmin = Boolean(userSummary?.is_super_admin);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f5ecff] via-white to-[#fef6ff] anim-fade-in">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-10 pt-24 pb-16">
          <div className="space-y-6">
            <div className="animate-pulse rounded-3xl bg-white/70 shadow-lg h-48" />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="animate-pulse h-96 rounded-3xl bg-white/70 shadow-lg lg:col-span-2" />
              <div className="animate-pulse h-96 rounded-3xl bg-white/70 shadow-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5ecff] via-white to-[#fef6ff] anim-fade-in">
      <Navbar />

      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 flex items-center space-x-3 rounded-xl px-4 py-3 shadow-xl border anim-pop ${
            toast.type === 'success'
              ? 'bg-green-600 text-white border-green-500'
              : 'bg-red-600 text-white border-red-500'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircleIcon className="h-5 w-5" />
          ) : (
            <ExclamationTriangleIcon className="h-5 w-5" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="rounded-full bg-white/20 p-1 hover:bg-white/30 transition"
            aria-label="Dismiss notification"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-10 pt-24 pb-16 space-y-8">
        <header className="anim-slide-up" style={{ animationDelay: '60ms' }}>
          <p className="text-sm font-semibold uppercase tracking-wider text-[#86288F]">Account Settings</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">Manage your profile & preferences</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Keep your contact details, account security, and permissions up to date for a seamless Accent CRM experience.
          </p>
        </header>

        <section className="rounded-3xl bg-white/90 shadow-xl border border-white/60 backdrop-blur-sm px-6 sm:px-8 py-8 anim-slide-up" style={{ animationDelay: '120ms' }}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative h-20 w-20 shrink-0">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={displayName}
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-2xl object-cover shadow-lg"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#64126D] to-[#86288F] text-2xl font-semibold text-white shadow-lg">
                    {initials}
                  </div>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 rounded-2xl bg-black/30 grid place-items-center">
                    <div className="h-6 w-6 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                  </div>
                )}
                <label className="absolute -bottom-2 -right-2 inline-flex cursor-pointer items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-white p-2 hover:bg-gray-50 transition">
                  <CameraIcon className="h-4 w-4 text-[#64126D]" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                    disabled={avatarUploading}
                  />
                </label>
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
                  {displayName}
                  {userSummary?.is_super_admin && (
                    <span className="inline-flex items-center rounded-full bg-gradient-to-r from-[#64126D] to-[#86288F] px-3 py-1 text-xs font-semibold uppercase text-white shadow-sm">
                      Super Admin
                    </span>
                  )}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-4 w-4 text-[#64126D]" />
                    {userSummary?.username || '—'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <EnvelopeIcon className="h-4 w-4 text-[#64126D]" />
                    {userSummary?.email || '—'}
                  </span>
                  {employeeSummary?.personal_email && (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheckIcon className="h-4 w-4 text-[#64126D]" />
                      Personal: {employeeSummary.personal_email}
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-gray-600">
                  <div>
                    <p className="font-semibold text-gray-500 uppercase tracking-wide text-xs">Department</p>
                    <p className="mt-1 text-gray-900">{userSummary?.department || employeeSummary?.department || '—'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500 uppercase tracking-wide text-xs">Role</p>
                    <p className="mt-1 text-gray-900">{userSummary?.role?.name || '—'}</p>
                    {userSummary?.role?.hierarchy !== undefined && (
                      <p className="text-xs text-gray-500">Level {userSummary.role.hierarchy}</p>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-500 uppercase tracking-wide text-xs">Status</p>
                    <p className="mt-1">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                          userSummary?.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {userSummary?.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-sm text-gray-600">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last Login</p>
                <p className="mt-1 font-medium text-gray-900">{formatDate(userSummary?.last_login)}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Password Updated</p>
                <p className="mt-1 font-medium text-gray-900">{formatDate(userSummary?.last_password_change)}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <section className="rounded-3xl bg-white shadow-xl border border-white/60 px-6 sm:px-8 py-8 anim-slide-up" style={{ animationDelay: '180ms' }}>
              <div className="flex items-center gap-3">
                <UserIcon className="h-6 w-6 text-[#64126D]" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Profile Information</h3>
                  <p className="text-sm text-gray-500">Update the name and primary email that appear across Accent CRM.</p>
                </div>
              </div>
              <form className="mt-6 space-y-4" onSubmit={handleProfileSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                      Full Name
                    </label>
                    <input
                      id="full_name"
                      type="text"
                      value={profileForm.full_name}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, full_name: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30 transition-transform duration-150 active:scale-[.99]"
                      placeholder="Your full name"
                      required
                      disabled={savingProfile}
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                      Work Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={profileForm.email}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, email: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30 transition-transform duration-150 active:scale-[.99]"
                      placeholder="name@company.com"
                      required
                      disabled={savingProfile}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-xl bg-gradient-to-r from-[#64126D] to-[#86288F] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={savingProfile}
                  >
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl bg-white shadow-xl border border-white/60 px-6 sm:px-8 py-8 anim-slide-up" style={{ animationDelay: '220ms' }}>
              <div className="flex items-center gap-3">
                <DevicePhoneMobileIcon className="h-6 w-6 text-[#64126D]" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Contact & Emergency Details</h3>
                  <p className="text-sm text-gray-500">These details help colleagues reach you quickly and power workflow automations.</p>
                </div>
              </div>

              {!hasEmployee && (
                <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5" />
                  <span>
                    {isSuperAdmin
                      ? 'Super admin does not require an HR employee profile. Contact details are optional and disabled for this account.'
                      : 'Your account is not linked to an employee record yet. Ask an administrator to complete your HR profile.'}
                  </span>
                </div>
              )}

              <form className="mt-6 space-y-4" onSubmit={handleContactSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                      Work Phone
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={employeeForm.phone}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, phone: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="Board line or extension"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                  <div>
                    <label htmlFor="mobile" className="block text-sm font-medium text-gray-700">
                      Mobile Number
                    </label>
                    <input
                      id="mobile"
                      type="tel"
                      value={employeeForm.mobile}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, mobile: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="Personal contact"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                  <div>
                    <label htmlFor="personal_email" className="block text-sm font-medium text-gray-700">
                      Personal Email
                    </label>
                    <input
                      id="personal_email"
                      type="email"
                      value={employeeForm.personal_email}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, personal_email: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="name@gmail.com"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                  <div>
                    <label htmlFor="country" className="block text-sm font-medium text-gray-700">
                      Country
                    </label>
                    <input
                      id="country"
                      type="text"
                      value={employeeForm.country}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, country: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="Country"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="city" className="block text-sm font-medium text-gray-700">
                      City
                    </label>
                    <input
                      id="city"
                      type="text"
                      value={employeeForm.city}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, city: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="City"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                  <div>
                    <label htmlFor="state" className="block text-sm font-medium text-gray-700">
                      State
                    </label>
                    <input
                      id="state"
                      type="text"
                      value={employeeForm.state}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, state: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="State"
                      disabled={savingContact || (isSuperAdmin && !hasEmployee)}
                    />
                  </div>
                  <div>
                    <label htmlFor="emergency_contact_phone" className="block text-sm font-medium text-gray-700">
                      Emergency Phone
                    </label>
                    <input
                      id="emergency_contact_phone"
                      type="tel"
                      value={employeeForm.emergency_contact_phone}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, emergency_contact_phone: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="Emergency contact number"
                      disabled={savingContact}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="present_address" className="block text-sm font-medium text-gray-700">
                    Current Address
                  </label>
                  <div className="mt-2 relative">
                    <textarea
                      id="present_address"
                      rows={3}
                      value={employeeForm.present_address}
                      onChange={(event) => setEmployeeForm((prev) => ({ ...prev, present_address: event.target.value }))}
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                      placeholder="Street, locality, and landmark"
                      disabled={savingContact}
                    />
                    <MapPinIcon className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-gray-300" />
                  </div>
                </div>

                <div>
                  <label htmlFor="emergency_contact_name" className="block text-sm font-medium text-gray-700">
                    Emergency Contact Name
                  </label>
                  <input
                    id="emergency_contact_name"
                    type="text"
                    value={employeeForm.emergency_contact_name}
                    onChange={(event) => setEmployeeForm((prev) => ({ ...prev, emergency_contact_name: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                    placeholder="Who should we call?"
                    disabled={!hasEmployee || savingContact}
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-xl bg-gradient-to-r from-green-500 to-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={savingContact}
                  >
                    {savingContact ? 'Saving...' : 'Save Contact Details'}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <div className="space-y-8">
            <section className="rounded-3xl bg-white shadow-xl border border-white/60 px-6 sm:px-8 py-8 anim-slide-up" style={{ animationDelay: '260ms' }}>
              <div className="flex items-center gap-3">
                <KeyIcon className="h-6 w-6 text-[#64126D]" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Security</h3>
                  <p className="text-sm text-gray-500">Change your password periodically to keep your account secure.</p>
                </div>
              </div>
              <form className="mt-6 space-y-4" onSubmit={handlePasswordSubmit}>
                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
                    Current Password
                  </label>
                  <input
                    id="currentPassword"
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                    placeholder="••••••••"
                    required
                    disabled={savingPassword}
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
                    New Password
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                    placeholder="At least 6 characters"
                    required
                    disabled={savingPassword}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                    Confirm New Password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-[#64126D] focus:ring-2 focus:ring-[#86288F]/30"
                    placeholder="Repeat new password"
                    required
                    disabled={savingPassword}
                    autoComplete="new-password"
                  />
                </div>
                <p className="text-xs text-gray-500">Password must be at least 6 characters long. Avoid reusing old passwords.</p>
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#64126D] to-[#86288F] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={savingPassword}
                >
                  {savingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </section>

            <section className="rounded-3xl bg-white shadow-xl border border-white/60 px-6 sm:px-8 py-8 anim-slide-up" style={{ animationDelay: '300ms' }}>
              <div className="flex items-center gap-3">
                <ShieldCheckIcon className="h-6 w-6 text-[#64126D]" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Permissions & Access</h3>
                  <p className="text-sm text-gray-500">Your access derives from role assignments and custom overrides.</p>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {Object.keys(permissionGroups).length === 0 ? (
                  <p className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    No permissions assigned yet. Contact an administrator if this looks incorrect.
                  </p>
                ) : (
                  Object.entries(permissionGroups).map(([resource, perms]) => (
                    <div key={resource} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{toTitle(resource)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {perms.map((permission, idx) => (
                          <span
                            key={permission}
                            className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-[#64126D] shadow-sm anim-scale-in"
                            style={{ animationDelay: `${40 * (idx % 6)}ms` }}
                          >
                            {toTitle(permission)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
