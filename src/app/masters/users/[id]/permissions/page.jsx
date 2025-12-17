'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES as RBAC_RESOURCES, PERMISSIONS as RBAC_PERMISSIONS } from '@/utils/rbac';
import {
  ArrowLeftIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Squares2X2Icon,
  ListBulletIcon
} from '@heroicons/react/24/outline';

// Comprehensive field definitions for each module
const MODULE_FIELDS = {
  leads: {
    name: 'Leads',
    description: 'Lead management and tracking',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          lead_id: { label: 'Lead ID', type: 'text' },
          company_name: { label: 'Company Name', type: 'text' },
          contact_name: { label: 'Contact Name', type: 'text' },
          designation: { label: 'Designation', type: 'text' },
          inquiry_email: { label: 'Email', type: 'email' },
          cc_emails: { label: 'CC Emails', type: 'text' },
          phone: { label: 'Phone', type: 'phone' },
          city: { label: 'City', type: 'text' }
        }
      },
      enquiry: {
        name: 'Enquiry Details',
        fields: {
          project_description: { label: 'Project Description', type: 'textarea' },
          enquiry_type: { label: 'Enquiry Type', type: 'select' },
          enquiry_status: { label: 'Enquiry Status', type: 'select' },
          enquiry_date: { label: 'Enquiry Date', type: 'date' },
          lead_source: { label: 'Lead Source', type: 'select' },
          priority: { label: 'Priority', type: 'select' },
          notes: { label: 'Notes', type: 'textarea' }
        }
      },
      followup: {
        name: 'Follow-up',
        fields: {
          first_followup_date: { label: 'Follow-up Date', type: 'date' },
          first_followup_type: { label: 'Follow-up Type', type: 'select' },
          first_followup_description: { label: 'Description', type: 'textarea' },
          first_followup_notes: { label: 'Follow-up Notes', type: 'textarea' }
        }
      }
    }
  },
  projects: {
    name: 'Projects',
    description: 'Project management',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          project_id: { label: 'Project ID', type: 'text' },
          project_code: { label: 'Project Code', type: 'text' },
          project_name: { label: 'Project Name', type: 'text' },
          client_name: { label: 'Client Name', type: 'text' },
          project_type: { label: 'Project Type', type: 'select' }
        }
      },
      details: {
        name: 'Project Details',
        fields: {
          description: { label: 'Description', type: 'textarea' },
          status: { label: 'Status', type: 'select' },
          priority: { label: 'Priority', type: 'select' },
          start_date: { label: 'Start Date', type: 'date' },
          end_date: { label: 'End Date', type: 'date' },
          due_date: { label: 'Due Date', type: 'date' }
        }
      },
      financial: {
        name: 'Financial',
        fields: {
          budget: { label: 'Budget', type: 'currency' },
          estimated_hours: { label: 'Estimated Hours', type: 'number' },
          actual_hours: { label: 'Actual Hours', type: 'number' },
          billing_type: { label: 'Billing Type', type: 'select' }
        }
      },
      team: {
        name: 'Team',
        fields: {
          project_manager: { label: 'Project Manager', type: 'select' },
          team_members: { label: 'Team Members', type: 'multiselect' },
          assigned_to: { label: 'Assigned To', type: 'select' }
        }
      }
    }
  },
  employees: {
    name: 'Employees',
    description: 'Employee records management',
    sections: {
      personal: {
        name: 'Personal Details',
        fields: {
          first_name: { label: 'First Name', type: 'text' },
          last_name: { label: 'Last Name', type: 'text' },
          email: { label: 'Email', type: 'email' },
          phone: { label: 'Phone', type: 'phone' },
          gender: { label: 'Gender', type: 'select' },
          date_of_birth: { label: 'Date of Birth', type: 'date' },
          marital_status: { label: 'Marital Status', type: 'select' },
          nationality: { label: 'Nationality', type: 'text' }
        }
      },
      emergency: {
        name: 'Emergency Contact',
        fields: {
          emergency_contact_name: { label: 'Emergency Contact Name', type: 'text' },
          emergency_contact_phone: { label: 'Emergency Contact Phone', type: 'phone' }
        }
      },
      address: {
        name: 'Address',
        fields: {
          address: { label: 'Address Line 1', type: 'text' },
          address_2: { label: 'Address Line 2', type: 'text' },
          city: { label: 'City', type: 'text' },
          state: { label: 'State', type: 'text' },
          country: { label: 'Country', type: 'text' },
          pin: { label: 'PIN/ZIP Code', type: 'text' }
        }
      },
      work: {
        name: 'Work Details',
        fields: {
          employee_id: { label: 'Employee ID', type: 'text' },
          department: { label: 'Department', type: 'select' },
          position: { label: 'Position', type: 'text' },
          level: { label: 'Level', type: 'select' },
          manager: { label: 'Manager', type: 'select' },
          reporting_to: { label: 'Reporting To', type: 'select' },
          hire_date: { label: 'Hire Date', type: 'date' },
          joining_date: { label: 'Joining Date', type: 'date' },
          employment_status: { label: 'Employment Status', type: 'select' },
          status: { label: 'Status', type: 'select' },
          workplace: { label: 'Workplace', type: 'text' }
        }
      },
      salary: {
        name: 'Salary & Compensation',
        fields: {
          salary: { label: 'Salary', type: 'currency', sensitive: true },
          basic_salary: { label: 'Basic Salary', type: 'currency', sensitive: true },
          hra: { label: 'HRA', type: 'currency', sensitive: true },
          conveyance: { label: 'Conveyance', type: 'currency', sensitive: true },
          medical_allowance: { label: 'Medical Allowance', type: 'currency', sensitive: true },
          special_allowance: { label: 'Special Allowance', type: 'currency', sensitive: true },
          incentives: { label: 'Incentives', type: 'currency', sensitive: true },
          deductions: { label: 'Deductions', type: 'currency', sensitive: true },
          bonus_eligible: { label: 'Bonus Eligible', type: 'boolean' }
        }
      },
      statutory: {
        name: 'Statutory Details',
        fields: {
          stat_pf: { label: 'PF Applicable', type: 'boolean' },
          stat_mlwf: { label: 'MLWF Applicable', type: 'boolean' },
          stat_pt: { label: 'PT Applicable', type: 'boolean' },
          stat_esic: { label: 'ESIC Applicable', type: 'boolean' },
          stat_tds: { label: 'TDS Applicable', type: 'boolean' }
        }
      },
      academic: {
        name: 'Academic & Experience',
        fields: {
          qualification: { label: 'Qualification', type: 'text' },
          institute: { label: 'Institute', type: 'text' },
          passing_year: { label: 'Passing Year', type: 'text' },
          work_experience: { label: 'Work Experience', type: 'text' }
        }
      },
      bank: {
        name: 'Bank Details',
        fields: {
          bank_name: { label: 'Bank Name', type: 'text', sensitive: true },
          bank_branch: { label: 'Bank Branch', type: 'text', sensitive: true },
          account_holder_name: { label: 'Account Holder Name', type: 'text', sensitive: true },
          bank_account_no: { label: 'Account Number', type: 'text', sensitive: true },
          bank_ifsc: { label: 'IFSC Code', type: 'text', sensitive: true }
        }
      },
      government: {
        name: 'Government IDs',
        fields: {
          pan: { label: 'PAN Number', type: 'text', sensitive: true },
          aadhar: { label: 'Aadhar Number', type: 'text', sensitive: true },
          gratuity_no: { label: 'Gratuity Number', type: 'text', sensitive: true },
          uan: { label: 'UAN', type: 'text', sensitive: true },
          esi_no: { label: 'ESI Number', type: 'text', sensitive: true }
        }
      },
      attendance: {
        name: 'Attendance & Exit',
        fields: {
          biometric_code: { label: 'Biometric Code', type: 'text' },
          attendance_id: { label: 'Attendance ID', type: 'text' },
          exit_date: { label: 'Exit Date', type: 'date' },
          exit_reason: { label: 'Exit Reason', type: 'textarea' }
        }
      }
    }
  },
  vendors: {
    name: 'Vendors',
    description: 'Vendor management',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          vendor_id: { label: 'Vendor ID', type: 'text' },
          vendor_name: { label: 'Vendor Name', type: 'text' },
          vendor_type: { label: 'Vendor Type', type: 'select' },
          status: { label: 'Status', type: 'select' }
        }
      },
      contact: {
        name: 'Contact Information',
        fields: {
          contact_person: { label: 'Contact Person', type: 'text' },
          email: { label: 'Email', type: 'email' },
          phone: { label: 'Phone', type: 'phone' },
          address: { label: 'Address', type: 'textarea' }
        }
      },
      financial: {
        name: 'Financial Details',
        fields: {
          gst_number: { label: 'GST Number', type: 'text' },
          pan_number: { label: 'PAN Number', type: 'text', sensitive: true },
          bank_details: { label: 'Bank Details', type: 'textarea', sensitive: true },
          payment_terms: { label: 'Payment Terms', type: 'select' }
        }
      }
    }
  },
  companies: {
    name: 'Companies',
    description: 'Client company records',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          company_id: { label: 'Company ID', type: 'text' },
          company_name: { label: 'Company Name', type: 'text' },
          industry: { label: 'Industry', type: 'select' },
          company_type: { label: 'Company Type', type: 'select' },
          status: { label: 'Status', type: 'select' }
        }
      },
      contact: {
        name: 'Contact Information',
        fields: {
          contact_person: { label: 'Contact Person', type: 'text' },
          email: { label: 'Email', type: 'email' },
          phone: { label: 'Phone', type: 'phone' },
          website: { label: 'Website', type: 'url' },
          address: { label: 'Address', type: 'textarea' }
        }
      },
      financial: {
        name: 'Financial Details',
        fields: {
          gst_number: { label: 'GST Number', type: 'text' },
          pan_number: { label: 'PAN Number', type: 'text', sensitive: true },
          credit_limit: { label: 'Credit Limit', type: 'currency', sensitive: true }
        }
      }
    }
  },
  proposals: {
    name: 'Proposals',
    description: 'Proposal creation and management',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          proposal_id: { label: 'Proposal ID', type: 'text' },
          proposal_name: { label: 'Proposal Name', type: 'text' },
          client_name: { label: 'Client Name', type: 'text' },
          project_name: { label: 'Project Name', type: 'text' },
          status: { label: 'Status', type: 'select' }
        }
      },
      details: {
        name: 'Proposal Details',
        fields: {
          description: { label: 'Description', type: 'textarea' },
          scope: { label: 'Scope of Work', type: 'textarea' },
          deliverables: { label: 'Deliverables', type: 'textarea' },
          timeline: { label: 'Timeline', type: 'text' },
          validity: { label: 'Validity Period', type: 'text' }
        }
      },
      financial: {
        name: 'Financial',
        fields: {
          total_amount: { label: 'Total Amount', type: 'currency', sensitive: true },
          discount: { label: 'Discount', type: 'currency' },
          tax: { label: 'Tax', type: 'currency' },
          final_amount: { label: 'Final Amount', type: 'currency', sensitive: true },
          payment_terms: { label: 'Payment Terms', type: 'textarea' }
        }
      }
    }
  },
  users: {
    name: 'Users',
    description: 'User account management',
    sections: {
      basic: {
        name: 'Basic Information',
        fields: {
          username: { label: 'Username', type: 'text' },
          email: { label: 'Email', type: 'email' },
          role: { label: 'Role', type: 'select' },
          status: { label: 'Status', type: 'select' }
        }
      },
      security: {
        name: 'Security',
        fields: {
          password: { label: 'Password', type: 'password', sensitive: true },
          is_super_admin: { label: 'Super Admin', type: 'boolean', sensitive: true },
          permissions: { label: 'Permissions', type: 'json', sensitive: true },
          last_login: { label: 'Last Login', type: 'datetime' }
        }
      }
    }
  },
  dashboard: {
    name: 'Dashboard',
    description: 'Main dashboard and analytics',
    sections: {
      widgets: {
        name: 'Dashboard Widgets',
        fields: {
          total_leads: { label: 'Total Leads Widget', type: 'widget' },
          total_projects: { label: 'Total Projects Widget', type: 'widget' },
          active_employees: { label: 'Active Employees Widget', type: 'widget' },
          revenue_chart: { label: 'Revenue Chart', type: 'widget' },
          activity_feed: { label: 'Activity Feed', type: 'widget' },
          recent_leads: { label: 'Recent Leads', type: 'widget' },
          project_status: { label: 'Project Status Chart', type: 'widget' }
        }
      }
    }
  },
  reports: {
    name: 'Reports',
    description: 'Reports and analytics',
    sections: {
      types: {
        name: 'Report Types',
        fields: {
          lead_reports: { label: 'Lead Reports', type: 'report' },
          project_reports: { label: 'Project Reports', type: 'report' },
          employee_reports: { label: 'Employee Reports', type: 'report' },
          financial_reports: { label: 'Financial Reports', type: 'report', sensitive: true },
          activity_reports: { label: 'Activity Reports', type: 'report' }
        }
      }
    }
  }
};

// Permission levels for fields
const FIELD_PERMISSIONS = {
  hidden: { label: 'Hidden', icon: EyeSlashIcon, color: 'text-red-500 bg-red-50 border-red-200' },
  view: { label: 'View Only', icon: EyeIcon, color: 'text-blue-500 bg-blue-50 border-blue-200' },
  edit: { label: 'Can Edit', icon: PencilIcon, color: 'text-green-500 bg-green-50 border-green-200' }
};

export default function UserPermissionsPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id;
  
  const { loading: rbacLoading, can, user: currentUser } = useSessionRBAC();
  const canUsersRead = !rbacLoading && (currentUser?.is_super_admin || can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.READ));
  const canUsersUpdate = !rbacLoading && (currentUser?.is_super_admin || can(RBAC_RESOURCES.USERS, RBAC_PERMISSIONS.UPDATE));
  
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [fieldPermissions, setFieldPermissions] = useState({});
  const [modulePermissions, setModulePermissions] = useState({}); // module-level CRUD
  const [originalPermissions, setOriginalPermissions] = useState({});
  const [activeModule, setActiveModule] = useState('leads');
  const [expandedSections, setExpandedSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  useEffect(() => {
    if (userId) {
      fetchUserData();
    }
  }, [userId]);

  // Track changes
  useEffect(() => {
    const current = JSON.stringify({ fieldPermissions, modulePermissions });
    const original = JSON.stringify(originalPermissions);
    setHasChanges(current !== original);
  }, [fieldPermissions, modulePermissions, originalPermissions]);

  // Expand all sections of active module by default
  useEffect(() => {
    if (activeModule && MODULE_FIELDS[activeModule]) {
      const sections = Object.keys(MODULE_FIELDS[activeModule].sections || {});
      const expanded = {};
      sections.forEach(s => expanded[`${activeModule}-${s}`] = true);
      setExpandedSections(prev => ({ ...prev, ...expanded }));
    }
  }, [activeModule]);

  const fetchUserData = async () => {
    setLoading(true);
    try {
      const userRes = await fetch(`/api/users/${userId}`);
      
      if (!userRes.ok) {
        console.error('Failed to fetch user, status:', userRes.status);
        setLoading(false);
        return;
      }
      
      const contentType = userRes.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Response is not JSON:', contentType);
        setLoading(false);
        return;
      }
      
      const userData = await userRes.json();
      
      if (userData.success && userData.data) {
        setUser(userData.data);
        
        // Parse existing permissions
        let existingPerms = userData.data.permissions;
        if (typeof existingPerms === 'string') {
          try {
            existingPerms = JSON.parse(existingPerms);
          } catch {
            existingPerms = [];
          }
        }
        existingPerms = existingPerms || [];
        
        // Parse field_permissions if exists, otherwise initialize
        let fieldPerms = userData.data.field_permissions;
        if (typeof fieldPerms === 'string') {
          try {
            fieldPerms = JSON.parse(fieldPerms);
          } catch {
            fieldPerms = {};
          }
        }
        fieldPerms = fieldPerms || {};
        
        // Initialize field permissions for all modules
        const initialFieldPerms = { ...fieldPerms };
        Object.keys(MODULE_FIELDS).forEach(module => {
          if (!initialFieldPerms[module]) {
            initialFieldPerms[module] = {};
          }
          const sections = MODULE_FIELDS[module].sections || {};
          Object.keys(sections).forEach(section => {
            const fields = sections[section].fields || {};
            Object.keys(fields).forEach(field => {
              if (!initialFieldPerms[module][field]) {
                // Default: view for non-sensitive, hidden for sensitive
                initialFieldPerms[module][field] = fields[field].sensitive ? 'hidden' : 'view';
              }
            });
          });
        });
        
        // Parse module-level permissions from array format
        const modulePerms = {};
        Object.keys(MODULE_FIELDS).forEach(module => {
          modulePerms[module] = {
            read: existingPerms.includes(`${module}:read`),
            create: existingPerms.includes(`${module}:create`),
            update: existingPerms.includes(`${module}:update`),
            delete: existingPerms.includes(`${module}:delete`),
            export: existingPerms.includes(`${module}:export`),
            import: existingPerms.includes(`${module}:import`)
          };
        });
        
        setFieldPermissions(initialFieldPerms);
        setModulePermissions(modulePerms);
        setOriginalPermissions({ 
          fieldPermissions: initialFieldPerms, 
          modulePermissions: modulePerms 
        });
        
        if (userData.data.employee_id) {
          const empRes = await fetch(`/api/employees/${userData.data.employee_id}`);
          const empData = await empRes.json();
          if (empData.success || empData.data) {
            setEmployee(empData.data || empData);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const setFieldPerm = (module, field, permission) => {
    setFieldPermissions(prev => ({
      ...prev,
      [module]: {
        ...prev[module],
        [field]: permission
      }
    }));
  };

  const toggleModulePerm = (module, permission) => {
    setModulePermissions(prev => ({
      ...prev,
      [module]: {
        ...prev[module],
        [permission]: !prev[module]?.[permission]
      }
    }));
  };

  const setAllFieldsInSection = (module, section, permission) => {
    const fields = MODULE_FIELDS[module]?.sections?.[section]?.fields || {};
    setFieldPermissions(prev => {
      const updated = { ...prev[module] };
      Object.keys(fields).forEach(field => {
        updated[field] = permission;
      });
      return { ...prev, [module]: updated };
    });
  };

  const setAllFieldsInModule = (module, permission) => {
    const sections = MODULE_FIELDS[module]?.sections || {};
    setFieldPermissions(prev => {
      const updated = { ...prev[module] };
      Object.keys(sections).forEach(section => {
        const fields = sections[section].fields || {};
        Object.keys(fields).forEach(field => {
          updated[field] = permission;
        });
      });
      return { ...prev, [module]: updated };
    });
  };

  const grantFullAccess = (module) => {
    // Grant all module-level permissions
    setModulePermissions(prev => ({
      ...prev,
      [module]: {
        read: true,
        create: true,
        update: true,
        delete: true,
        export: true,
        import: true
      }
    }));
    // Set all fields to edit
    setAllFieldsInModule(module, 'edit');
  };

  const revokeAllAccess = (module) => {
    // Revoke all module-level permissions
    setModulePermissions(prev => ({
      ...prev,
      [module]: {
        read: false,
        create: false,
        update: false,
        delete: false,
        export: false,
        import: false
      }
    }));
    // Set all fields to hidden
    setAllFieldsInModule(module, 'hidden');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Store old values for audit log
      const oldModulePermissions = { ...originalPermissions.modulePermissions };
      const oldFieldPermissions = { ...originalPermissions.fieldPermissions };
      
      // Convert module permissions back to array format
      const permissionsArray = [];
      Object.keys(modulePermissions).forEach(module => {
        const perms = modulePermissions[module] || {};
        if (perms.read) permissionsArray.push(`${module}:read`);
        if (perms.create) permissionsArray.push(`${module}:create`);
        if (perms.update) permissionsArray.push(`${module}:update`);
        if (perms.delete) permissionsArray.push(`${module}:delete`);
        if (perms.export) permissionsArray.push(`${module}:export`);
        if (perms.import) permissionsArray.push(`${module}:import`);
      });
      
      // Convert old module permissions to array for comparison
      const oldPermissionsArray = [];
      Object.keys(oldModulePermissions).forEach(module => {
        const perms = oldModulePermissions[module] || {};
        if (perms.read) oldPermissionsArray.push(`${module}:read`);
        if (perms.create) oldPermissionsArray.push(`${module}:create`);
        if (perms.update) oldPermissionsArray.push(`${module}:update`);
        if (perms.delete) oldPermissionsArray.push(`${module}:delete`);
        if (perms.export) oldPermissionsArray.push(`${module}:export`);
        if (perms.import) oldPermissionsArray.push(`${module}:import`);
      });

      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.id,
          permissions: permissionsArray,
          field_permissions: fieldPermissions
        })
      });

      const data = await res.json();
      if (data.success) {
        // Log the permission change to audit logs
        try {
          await fetch('/api/audit-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_permissions',
              resource: 'user_permissions',
              resource_id: user.id,
              old_value: {
                permissions: oldPermissionsArray,
                field_permissions: oldFieldPermissions
              },
              new_value: {
                permissions: permissionsArray,
                field_permissions: fieldPermissions
              }
            })
          });
        } catch (auditError) {
          console.error('Failed to log audit:', auditError);
        }
        
        setOriginalPermissions({ fieldPermissions, modulePermissions });
        setHasChanges(false);
        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-2';
        notification.innerHTML = '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg><span>Permissions saved successfully!</span>';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
      } else {
        alert(data.error || 'Failed to save permissions');
      }
    } catch {
      alert('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to leave?')) {
        router.push('/masters/users');
      }
    } else {
      router.push('/masters/users');
    }
  };

  const getFieldPermCount = (module) => {
    const perms = fieldPermissions[module] || {};
    const counts = { hidden: 0, view: 0, edit: 0 };
    Object.values(perms).forEach(p => {
      if (counts[p] !== undefined) counts[p]++;
    });
    return counts;
  };

  const getModulePermCount = (module) => {
    const perms = modulePermissions[module] || {};
    return Object.values(perms).filter(Boolean).length;
  };

  if (rbacLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading permissions...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!canUsersRead) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <Navbar />
        <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
          <div className="flex items-center justify-center h-[calc(100vh-120px)]">
            <div className="text-center">
              <LockClosedIcon className="h-16 w-16 text-gray-400 mx-auto" />
              <h2 className="mt-4 text-xl font-semibold text-gray-900">Access Denied</h2>
              <p className="mt-2 text-gray-600">You don&apos;t have permission to view user permissions.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentModule = MODULE_FIELDS[activeModule];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleCancel}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
                  <ShieldCheckIcon className="h-7 w-7 text-blue-600" />
                  <span>Field-Level Permissions</span>
                </h1>
                {user && (
                  <p className="text-gray-600 mt-1">
                    {employee ? `${employee.first_name} ${employee.last_name}` : user.username} • {user.email}
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              {hasChanges && (
                <span className="text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                  Unsaved changes
                </span>
              )}
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canUsersUpdate || saving || !hasChanges}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CheckIcon className="h-4 w-4" />
                    <span>Save Permissions</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-6 h-[calc(100vh-200px)]">
          {/* Module Sidebar */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-full flex flex-col">
              <div className="p-4 bg-gray-50 border-b border-gray-200 flex-shrink-0">
                <h3 className="font-semibold text-gray-900">Modules</h3>
              </div>
              <div className="p-2 overflow-y-auto flex-1">
                {Object.keys(MODULE_FIELDS).map(module => {
                  const moduleDef = MODULE_FIELDS[module];
                  const fieldCounts = getFieldPermCount(module);
                  const moduleCount = getModulePermCount(module);
                  const isActive = activeModule === module;
                  
                  return (
                    <button
                      key={module}
                      onClick={() => setActiveModule(module)}
                      className={`w-full text-left px-3 py-3 rounded-lg transition-all ${
                        isActive 
                          ? 'bg-blue-50 border-l-4 border-blue-500' 
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                          {moduleDef.name}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          moduleCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {moduleCount}/6
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-xs text-green-600">{fieldCounts.edit}E</span>
                        <span className="text-xs text-blue-600">{fieldCounts.view}V</span>
                        <span className="text-xs text-red-600">{fieldCounts.hidden}H</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 h-full">
            {currentModule && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 h-full flex flex-col overflow-hidden">
                {/* Module Header */}
                <div className="p-6 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{currentModule.name}</h2>
                      <p className="text-gray-600 text-sm mt-1">{currentModule.description}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}`}
                      >
                        <Squares2X2Icon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100'}`}
                      >
                        <ListBulletIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Module-level Permissions */}
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-gray-900">Module Access</h3>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => grantFullAccess(activeModule)}
                          className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
                        >
                          Grant All
                        </button>
                        <button
                          onClick={() => revokeAllAccess(activeModule)}
                          className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          Revoke All
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {['read', 'create', 'update', 'delete', 'export', 'import'].map(perm => (
                        <button
                          key={perm}
                          onClick={() => toggleModulePerm(activeModule, perm)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                            modulePermissions[activeModule]?.[perm]
                              ? 'bg-blue-600 text-white'
                              : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300'
                          }`}
                        >
                          {perm.charAt(0).toUpperCase() + perm.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Field Sections - Scrollable */}
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                  {Object.entries(currentModule.sections || {}).map(([sectionKey, section]) => {
                    const isExpanded = expandedSections[`${activeModule}-${sectionKey}`];
                    const fields = section.fields || {};
                    
                    return (
                      <div key={sectionKey} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Section Header */}
                        <div className="flex items-center justify-between p-4 bg-gray-50">
                          <div 
                            onClick={() => toggleSection(`${activeModule}-${sectionKey}`)}
                            className="flex items-center space-x-3 cursor-pointer hover:bg-gray-100 -m-2 p-2 rounded-lg transition-colors flex-1"
                          >
                            {isExpanded ? (
                              <ChevronDownIcon className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                            )}
                            <span className="font-medium text-gray-900">{section.name}</span>
                            <span className="text-sm text-gray-500">({Object.keys(fields).length} fields)</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'edit')}
                              className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                            >
                              All Edit
                            </button>
                            <button
                              onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'view')}
                              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              All View
                            </button>
                            <button
                              onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'hidden')}
                              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              All Hide
                            </button>
                          </div>
                        </div>

                        {/* Fields */}
                        {isExpanded && (
                          <div className={`p-4 ${viewMode === 'grid' ? 'grid grid-cols-2 lg:grid-cols-3 gap-3' : 'space-y-2'}`}>
                            {Object.entries(fields).map(([fieldKey, field]) => {
                              const currentPerm = fieldPermissions[activeModule]?.[fieldKey] || 'view';
                              const PermIcon = FIELD_PERMISSIONS[currentPerm]?.icon || EyeIcon;
                              
                              return (
                                <div 
                                  key={fieldKey}
                                  className={`p-3 rounded-lg border ${FIELD_PERMISSIONS[currentPerm]?.color || 'border-gray-200'} ${
                                    viewMode === 'list' ? 'flex items-center justify-between' : ''
                                  }`}
                                >
                                  <div className={viewMode === 'list' ? 'flex items-center space-x-3' : ''}>
                                    <div className="flex items-center space-x-2 mb-2">
                                      <PermIcon className={`h-4 w-4 ${
                                        currentPerm === 'edit' ? 'text-green-500' :
                                        currentPerm === 'view' ? 'text-blue-500' : 'text-red-500'
                                      }`} />
                                      <span className="font-medium text-gray-900 text-sm">{field.label}</span>
                                      {field.sensitive && (
                                        <LockClosedIcon className="h-3 w-3 text-amber-500" title="Sensitive field" />
                                      )}
                                    </div>
                                    {viewMode === 'grid' && (
                                      <p className="text-xs text-gray-500 mb-2">{field.type}</p>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center space-x-1">
                                    {Object.entries(FIELD_PERMISSIONS).map(([permKey, permDef]) => (
                                      <button
                                        key={permKey}
                                        onClick={() => setFieldPerm(activeModule, fieldKey, permKey)}
                                        className={`p-1.5 rounded transition-all ${
                                          currentPerm === permKey
                                            ? permKey === 'edit' ? 'bg-green-500 text-white' :
                                              permKey === 'view' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'
                                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                        }`}
                                        title={permDef.label}
                                      >
                                        <permDef.icon className="h-4 w-4" />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Legend - Inside scrollable area */}
                  <div className="p-4 bg-gray-50 rounded-lg mt-4">
                    <h4 className="font-medium text-gray-900 mb-3">Permission Legend</h4>
                    <div className="flex flex-wrap gap-4">
                      {Object.entries(FIELD_PERMISSIONS).map(([key, perm]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <div className={`p-1.5 rounded ${
                            key === 'edit' ? 'bg-green-500' :
                            key === 'view' ? 'bg-blue-500' : 'bg-red-500'
                          }`}>
                            <perm.icon className="h-4 w-4 text-white" />
                          </div>
                          <span className="text-sm text-gray-600">{perm.label}</span>
                        </div>
                      ))}
                      <div className="flex items-center space-x-2">
                        <LockClosedIcon className="h-4 w-4 text-amber-500" />
                        <span className="text-sm text-gray-600">Sensitive Field</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
