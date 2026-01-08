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
  ListBulletIcon
} from '@heroicons/react/24/outline';

// Comprehensive field definitions for each module
const MODULE_FIELDS = {
  // ==================== MODULES ====================
  dashboard: {
    name: 'Dashboard',
    description: 'Main dashboard and analytics',
    category: 'module',
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
  leads: {
    name: 'Leads',
    description: 'Lead management and tracking',
    category: 'module',
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
  proposals: {
    name: 'Proposals',
    description: 'Proposal creation and management',
    category: 'module',
    sections: {
      basic: {
        name: 'Basic Info',
        fields: {
          proposal_id: { label: 'Proposal ID', type: 'text' },
          proposal_name: { label: 'Proposal Name', type: 'text' },
          client_name: { label: 'Client Name', type: 'text' },
          project_name: { label: 'Project Name', type: 'text' },
          contact_person: { label: 'Contact Person', type: 'text' },
          contact_email: { label: 'Contact Email', type: 'email' },
          contact_phone: { label: 'Contact Phone', type: 'phone' },
          status: { label: 'Status', type: 'select' },
          proposal_date: { label: 'Proposal Date', type: 'date' }
        }
      },
      scope: {
        name: 'Scope of Work',
        fields: {
          scope_description: { label: 'Scope Description', type: 'textarea' },
          disciplines: { label: 'Disciplines', type: 'multiselect' },
          activities: { label: 'Activities', type: 'multiselect' },
          scope_details: { label: 'Scope Details', type: 'textarea' }
        }
      },
      input_documents: {
        name: 'Input Documents',
        fields: {
          document_name: { label: 'Document Name', type: 'text' },
          document_type: { label: 'Document Type', type: 'select' },
          document_file: { label: 'Document File', type: 'file' },
          received_date: { label: 'Received Date', type: 'date' }
        }
      },
      deliverables: {
        name: 'Deliverables',
        fields: {
          deliverable_name: { label: 'Deliverable Name', type: 'text' },
          deliverable_type: { label: 'Deliverable Type', type: 'select' },
          deliverable_format: { label: 'Format', type: 'select' },
          deliverable_description: { label: 'Description', type: 'textarea' }
        }
      },
      software: {
        name: 'Software',
        fields: {
          software_name: { label: 'Software Name', type: 'text' },
          software_version: { label: 'Version', type: 'text' },
          license_type: { label: 'License Type', type: 'select' }
        }
      },
      mode_of_delivery: {
        name: 'Mode of Delivery',
        fields: {
          delivery_mode: { label: 'Delivery Mode', type: 'select' },
          delivery_format: { label: 'Delivery Format', type: 'select' },
          delivery_notes: { label: 'Delivery Notes', type: 'textarea' }
        }
      },
      revision: {
        name: 'Revision',
        fields: {
          revision_count: { label: 'Revision Count', type: 'number' },
          revision_terms: { label: 'Revision Terms', type: 'textarea' },
          additional_revision_cost: { label: 'Additional Revision Cost', type: 'currency' }
        }
      },
      site_visit: {
        name: 'Site Visit',
        fields: {
          site_visit_required: { label: 'Site Visit Required', type: 'boolean' },
          site_visit_count: { label: 'Number of Visits', type: 'number' },
          site_visit_cost: { label: 'Site Visit Cost', type: 'currency' },
          site_visit_notes: { label: 'Site Visit Notes', type: 'textarea' }
        }
      },
      quotation_validity: {
        name: 'Quotation Validity',
        fields: {
          validity_period: { label: 'Validity Period', type: 'text' },
          validity_date: { label: 'Valid Until', type: 'date' },
          validity_terms: { label: 'Validity Terms', type: 'textarea' }
        }
      },
      exclusions: {
        name: 'Exclusions',
        fields: {
          exclusion_items: { label: 'Exclusion Items', type: 'textarea' },
          exclusion_notes: { label: 'Exclusion Notes', type: 'textarea' }
        }
      },
      commercials: {
        name: 'Commercials',
        fields: {
          total_amount: { label: 'Total Amount', type: 'currency', sensitive: true },
          discount: { label: 'Discount', type: 'currency' },
          discount_percent: { label: 'Discount %', type: 'number' },
          tax: { label: 'Tax', type: 'currency' },
          final_amount: { label: 'Final Amount', type: 'currency', sensitive: true },
          payment_terms: { label: 'Payment Terms', type: 'textarea' },
          payment_schedule: { label: 'Payment Schedule', type: 'textarea' }
        }
      },
      quotation: {
        name: 'Quotation Details',
        fields: {
          quotation_number: { label: 'Quotation Number', type: 'text' },
          duration: { label: 'Duration', type: 'text' },
          manhours: { label: 'Manhours', type: 'number' },
          profitability_estimate: { label: 'Profitability Estimate', type: 'currency', sensitive: true },
          price_breakup: { label: 'Price Breakup', type: 'textarea' }
        }
      },
      followups: {
        name: 'Follow-ups',
        fields: {
          followup_date: { label: 'Follow-up Date', type: 'date' },
          followup_type: { label: 'Follow-up Type', type: 'select' },
          followup_status: { label: 'Follow-up Status', type: 'select' },
          followup_notes: { label: 'Follow-up Notes', type: 'textarea' },
          next_followup_date: { label: 'Next Follow-up Date', type: 'date' }
        }
      }
    }
  },
  projects: {
    name: 'Projects',
    description: 'Project management',
    category: 'module',
    sections: {
      project_details: {
        name: 'Project Details',
        fields: {
          project_id: { label: 'Project ID', type: 'text' },
          project_code: { label: 'Project Code', type: 'text' },
          project_name: { label: 'Project Name', type: 'text' },
          client_name: { label: 'Client Name', type: 'text' },
          project_type: { label: 'Project Type', type: 'select' },
          description: { label: 'Description', type: 'textarea' },
          status: { label: 'Status', type: 'select' },
          priority: { label: 'Priority', type: 'select' },
          start_date: { label: 'Start Date', type: 'date' },
          end_date: { label: 'End Date', type: 'date' },
          due_date: { label: 'Due Date', type: 'date' },
          project_manager: { label: 'Project Manager', type: 'select' },
          team_members: { label: 'Team Members', type: 'multiselect' }
        }
      },
      scope: {
        name: 'Scope',
        fields: {
          original_scope: { label: 'Original Scope', type: 'textarea' },
          additional_scope: { label: 'Additional Scope', type: 'textarea' },
          scope_changes: { label: 'Scope Changes', type: 'textarea' },
          deliverables: { label: 'Deliverables', type: 'textarea' }
        }
      },
      minutes_internal_meet: {
        name: 'Meetings',
        fields: {
          meeting_date: { label: 'Meeting Date', type: 'date' },
          meeting_type: { label: 'Meeting Type', type: 'select' },
          attendees: { label: 'Attendees', type: 'multiselect' },
          minutes: { label: 'Minutes of Meeting', type: 'textarea' },
          action_items: { label: 'Action Items', type: 'textarea' }
        }
      },
      documents_received: {
        name: 'Documents Received',
        fields: {
          document_name: { label: 'Document Name', type: 'text' },
          document_type: { label: 'Document Type', type: 'select' },
          received_date: { label: 'Received Date', type: 'date' },
          received_from: { label: 'Received From', type: 'text' },
          document_file: { label: 'Document File', type: 'file' }
        }
      },
      project_schedule: {
        name: 'Project Schedule',
        fields: {
          milestone_name: { label: 'Milestone Name', type: 'text' },
          planned_start: { label: 'Planned Start', type: 'date' },
          planned_end: { label: 'Planned End', type: 'date' },
          actual_start: { label: 'Actual Start', type: 'date' },
          actual_end: { label: 'Actual End', type: 'date' },
          progress: { label: 'Progress', type: 'number' }
        }
      },
      project_activity: {
        name: 'Project Activity',
        fields: {
          activity_name: { label: 'Activity Name', type: 'text' },
          assigned_to: { label: 'Assigned To', type: 'select' },
          activity_status: { label: 'Activity Status', type: 'select' },
          estimated_hours: { label: 'Estimated Hours', type: 'number' },
          actual_hours: { label: 'Actual Hours', type: 'number' },
          activity_progress: { label: 'Activity Progress', type: 'number' }
        }
      },
      documents_issued: {
        name: 'Documents Issued',
        fields: {
          issued_doc_name: { label: 'Document Name', type: 'text' },
          issued_doc_type: { label: 'Document Type', type: 'select' },
          issue_date: { label: 'Issue Date', type: 'date' },
          issued_to: { label: 'Issued To', type: 'text' },
          revision: { label: 'Revision', type: 'text' },
          issued_file: { label: 'Document File', type: 'file' }
        }
      },
      project_handover: {
        name: 'Project Handover',
        fields: {
          handover_date: { label: 'Handover Date', type: 'date' },
          handover_to: { label: 'Handover To', type: 'text' },
          handover_notes: { label: 'Handover Notes', type: 'textarea' },
          completion_certificate: { label: 'Completion Certificate', type: 'file' },
          final_deliverables: { label: 'Final Deliverables', type: 'textarea' }
        }
      },
      project_manhours: {
        name: 'Project Manhours',
        fields: {
          budget_hours: { label: 'Budget Hours', type: 'number' },
          estimated_hours: { label: 'Estimated Hours', type: 'number' },
          actual_hours: { label: 'Actual Hours', type: 'number' },
          variance: { label: 'Variance', type: 'number' },
          manhours_report: { label: 'Manhours Report', type: 'report' }
        }
      },
      commercial: {
        name: 'Commercial',
        fields: {
          budget: { label: 'Budget', type: 'currency', sensitive: true },
          billing_type: { label: 'Billing Type', type: 'select' },
          invoice_amount: { label: 'Invoice Amount', type: 'currency', sensitive: true },
          payment_status: { label: 'Payment Status', type: 'select' },
          profitability: { label: 'Profitability', type: 'currency', sensitive: true }
        }
      },
      query_log: {
        name: 'Query Log',
        fields: {
          query_date: { label: 'Query Date', type: 'date' },
          query_from: { label: 'Query From', type: 'text' },
          query_description: { label: 'Query Description', type: 'textarea' },
          response: { label: 'Response', type: 'textarea' },
          response_date: { label: 'Response Date', type: 'date' },
          query_status: { label: 'Status', type: 'select' }
        }
      },
      assumption: {
        name: 'Assumptions',
        fields: {
          assumption_text: { label: 'Assumption', type: 'textarea' },
          assumption_category: { label: 'Category', type: 'select' },
          assumption_status: { label: 'Status', type: 'select' },
          validation_date: { label: 'Validation Date', type: 'date' }
        }
      },
      lessons_learnt: {
        name: 'Lessons Learnt',
        fields: {
          lesson_category: { label: 'Category', type: 'select' },
          lesson_description: { label: 'Description', type: 'textarea' },
          recommendations: { label: 'Recommendations', type: 'textarea' },
          lesson_date: { label: 'Date Recorded', type: 'date' }
        }
      }
    }
  },
  quotations: {
    name: 'Quotations',
    description: 'Project quotation management',
    category: 'financial',
    sections: {
      quotation_details: {
        name: 'Quotation Details',
        fields: {
          quotation_number: { label: 'Quotation Number', type: 'text' },
          quotation_date: { label: 'Quotation Date', type: 'date' },
          enquiry_number: { label: 'Enquiry Number', type: 'text' },
          enquiry_quantity: { label: 'Enquiry Quantity', type: 'number' },
          scope_of_work: { label: 'Scope of Work', type: 'textarea' },
          client_name: { label: 'Client Name', type: 'text' }
        }
      },
      quotation_amounts: {
        name: 'Quotation Amounts',
        fields: {
          gross_amount: { label: 'Gross Amount', type: 'currency', sensitive: true },
          gst_percentage: { label: 'GST Percentage', type: 'number' },
          gst_amount: { label: 'GST Amount', type: 'currency', sensitive: true },
          net_amount: { label: 'Net Amount', type: 'currency', sensitive: true }
        }
      }
    }
  },
  purchase_orders: {
    name: 'Purchase Orders',
    description: 'Project purchase order management',
    category: 'financial',
    sections: {
      po_details: {
        name: 'PO Details',
        fields: {
          po_number: { label: 'PO Number', type: 'text' },
          po_date: { label: 'PO Date', type: 'date' },
          vendor_name: { label: 'Vendor Name', type: 'text' },
          delivery_date: { label: 'Delivery Date', type: 'date' },
          scope_of_work: { label: 'Scope of Work', type: 'textarea' }
        }
      },
      po_amounts: {
        name: 'PO Amounts',
        fields: {
          gross_amount: { label: 'Gross Amount', type: 'currency', sensitive: true },
          gst_percentage: { label: 'GST Percentage', type: 'number' },
          gst_amount: { label: 'GST Amount', type: 'currency', sensitive: true },
          net_amount: { label: 'Net Amount', type: 'currency', sensitive: true },
          payment_terms: { label: 'Payment Terms', type: 'text' },
          remarks: { label: 'Remarks', type: 'textarea' }
        }
      }
    }
  },
  invoices: {
    name: 'Invoices',
    description: 'Project invoice management',
    category: 'financial',
    sections: {
      invoice_details: {
        name: 'Invoice Details',
        fields: {
          invoice_number: { label: 'Invoice Number', type: 'text' },
          invoice_date: { label: 'Invoice Date', type: 'date' },
          invoice_amount: { label: 'Invoice Amount', type: 'currency', sensitive: true },
          payment_due_date: { label: 'Payment Due Date', type: 'date' },
          scope_of_work: { label: 'Scope of Work', type: 'textarea' },
          remarks: { label: 'Remarks', type: 'textarea' },
          payment_status: { label: 'Payment Status', type: 'select' }
        }
      },
      invoice_amounts: {
        name: 'Invoice Amounts',
        fields: {
          total_po_value: { label: 'Total PO Value', type: 'currency', sensitive: true },
          invoiced_amount: { label: 'Total Invoiced', type: 'currency', sensitive: true },
          balance_amount: { label: 'Balance Amount', type: 'currency', sensitive: true }
        }
      }
    }
  },
  admin: {
    name: 'Admin',
    description: 'Administrative functions and monitoring',
    category: 'module',
    sections: {
      monitoring: {
        name: 'Monitoring',
        fields: {
          live_monitoring: { label: 'Live Monitoring', type: 'view' },
          active_users: { label: 'Active Users', type: 'widget' },
          user_status: { label: 'User Status', type: 'view' },
          screen_time: { label: 'Screen Time', type: 'report' }
        }
      },
      logs: {
        name: 'Activity Logs',
        fields: {
          view_logs: { label: 'View Logs', type: 'view' },
          filter_by_user: { label: 'Filter by User', type: 'select' },
          filter_by_action: { label: 'Filter by Action', type: 'select' },
          export_logs: { label: 'Export Logs', type: 'action' }
        }
      },
      todos: {
        name: 'All Todos',
        fields: {
          view_all_todos: { label: 'View All Todos', type: 'view' },
          manage_todos: { label: 'Manage Todos', type: 'action' },
          assign_todos: { label: 'Assign Todos', type: 'action' }
        }
      }
    }
  },
  // ==================== MASTERS ====================
  employees: {
    name: 'Employee Master',
    description: 'Employee records management',
    category: 'master',
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
  users: {
    name: 'User Master',
    description: 'User account management',
    category: 'master',
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
  activities: {
    name: 'Activity Master',
    description: 'Manage disciplines, activities and sub-activities',
    category: 'master',
    sections: {
      disciplines: {
        name: 'Disciplines',
        fields: {
          function_name: { label: 'Discipline Name', type: 'text' },
          status: { label: 'Status', type: 'select' },
          description: { label: 'Description', type: 'textarea' }
        }
      },
      activities_list: {
        name: 'Activities',
        fields: {
          activity_name: { label: 'Activity Name', type: 'text' },
          function_id: { label: 'Parent Discipline', type: 'select' }
        }
      },
      sub_activities: {
        name: 'Sub-Activities',
        fields: {
          name: { label: 'Sub-Activity Name', type: 'text' },
          default_manhours: { label: 'Default Manhours', type: 'number' },
          default_rate: { label: 'Default Rate', type: 'currency' }
        }
      }
    }
  },
  software: {
    name: 'Software Master',
    description: 'Manage software and versions',
    category: 'master',
    sections: {
      software_list: {
        name: 'Software',
        fields: {
          software_name: { label: 'Software Name', type: 'text' },
          category: { label: 'Category', type: 'select' },
          vendor: { label: 'Vendor', type: 'text' },
          license_type: { label: 'License Type', type: 'select' },
          status: { label: 'Status', type: 'select' }
        }
      },
      versions: {
        name: 'Versions',
        fields: {
          version_number: { label: 'Version Number', type: 'text' },
          release_date: { label: 'Release Date', type: 'date' },
          is_active: { label: 'Is Active', type: 'boolean' }
        }
      }
    }
  },
  companies: {
    name: 'Company Master',
    description: 'Client company records',
    category: 'master',
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
  vendors: {
    name: 'Vendor Master',
    description: 'Vendor management',
    category: 'master',
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
  const [enabledModules, setEnabledModules] = useState({}); // which modules are enabled
  const [enabledSections, setEnabledSections] = useState({}); // which sections are enabled within modules
  const [originalPermissions, setOriginalPermissions] = useState({});
  const [activeModule, setActiveModule] = useState(null); // currently selected module for field editing
  const [expandedSections, setExpandedSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isReady, setIsReady] = useState(false); // Prevents UI flash until everything is loaded

  useEffect(() => {
    if (userId && !rbacLoading) {
      fetchUserData();
    }
  }, [userId, rbacLoading]);

  // Mark as ready only when all data is loaded and permissions are checked
  useEffect(() => {
    if (!rbacLoading && !loading && user !== null) {
      // Small delay to ensure all state is settled
      const timer = setTimeout(() => setIsReady(true), 50);
      return () => clearTimeout(timer);
    }
  }, [rbacLoading, loading, user]);

  // Track changes
  useEffect(() => {
    const current = JSON.stringify({ fieldPermissions, modulePermissions, enabledModules, enabledSections });
    const original = JSON.stringify(originalPermissions);
    setHasChanges(current !== original);
  }, [fieldPermissions, modulePermissions, enabledModules, enabledSections, originalPermissions]);

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
        
        // Parse existing permissions (flat array for backward compatibility)
        let existingPerms = userData.data.permissions;
        if (typeof existingPerms === 'string') {
          try {
            existingPerms = JSON.parse(existingPerms);
          } catch {
            existingPerms = [];
          }
        }
        existingPerms = existingPerms || [];
        
        // Parse field_permissions - now supports nested structure
        let fieldPerms = userData.data.field_permissions;
        if (typeof fieldPerms === 'string') {
          try {
            fieldPerms = JSON.parse(fieldPerms);
          } catch {
            fieldPerms = {};
          }
        }
        fieldPerms = fieldPerms || {};
        
        // Check if we have the new nested structure
        const isNestedStructure = fieldPerms.modules !== undefined;
        
        // Initialize state from nested structure or legacy format
        const initialFieldPerms = {};
        const modulePerms = {};
        const enabled = {};
        const sectionEnabled = {};
        
        Object.keys(MODULE_FIELDS).forEach(moduleKey => {
          const moduleDef = MODULE_FIELDS[moduleKey];
          initialFieldPerms[moduleKey] = {};
          sectionEnabled[moduleKey] = {};
          
          if (isNestedStructure && fieldPerms.modules?.[moduleKey]) {
            // Load from nested structure
            const savedModule = fieldPerms.modules[moduleKey];
            enabled[moduleKey] = savedModule.enabled || false;
            modulePerms[moduleKey] = {
              read: savedModule.crud?.read || false,
              create: savedModule.crud?.create || false,
              update: savedModule.crud?.update || false,
              delete: savedModule.crud?.delete || false,
              export: savedModule.crud?.export || false,
              import: savedModule.crud?.import || false
            };
            
            // Load sections and fields
            const sections = moduleDef.sections || {};
            Object.keys(sections).forEach(sectionKey => {
              const savedSection = savedModule.sections?.[sectionKey];
              sectionEnabled[moduleKey][sectionKey] = savedSection?.enabled || false;
              
              const fields = sections[sectionKey].fields || {};
              Object.keys(fields).forEach(fieldKey => {
                const savedField = savedSection?.fields?.[fieldKey];
                initialFieldPerms[moduleKey][fieldKey] = savedField?.permission || 
                  (fields[fieldKey].sensitive ? 'hidden' : 'view');
              });
            });
          } else {
            // Legacy format - parse from flat arrays
            const hasRead = existingPerms.includes(`${moduleKey}:read`);
            const hasCreate = existingPerms.includes(`${moduleKey}:create`);
            const hasUpdate = existingPerms.includes(`${moduleKey}:update`);
            const hasDelete = existingPerms.includes(`${moduleKey}:delete`);
            const hasExport = existingPerms.includes(`${moduleKey}:export`);
            const hasImport = existingPerms.includes(`${moduleKey}:import`);
            
            modulePerms[moduleKey] = {
              read: hasRead,
              create: hasCreate,
              update: hasUpdate,
              delete: hasDelete,
              export: hasExport,
              import: hasImport
            };
            
            enabled[moduleKey] = hasRead || hasCreate || hasUpdate || hasDelete || hasExport || hasImport;
            
            // Load legacy field permissions
            const sections = moduleDef.sections || {};
            Object.keys(sections).forEach(sectionKey => {
              const fields = sections[sectionKey].fields || {};
              let hasVisibleField = false;
              
              Object.keys(fields).forEach(fieldKey => {
                // Check legacy format (direct module.field mapping)
                const legacyPerm = fieldPerms[moduleKey]?.[fieldKey];
                if (legacyPerm && typeof legacyPerm === 'string') {
                  initialFieldPerms[moduleKey][fieldKey] = legacyPerm;
                  if (legacyPerm !== 'hidden') hasVisibleField = true;
                } else {
                  initialFieldPerms[moduleKey][fieldKey] = fields[fieldKey].sensitive ? 'hidden' : 'view';
                  if (!fields[fieldKey].sensitive) hasVisibleField = true;
                }
              });
              
              sectionEnabled[moduleKey][sectionKey] = enabled[moduleKey] && hasVisibleField;
            });
          }
        });
        
        setFieldPermissions(initialFieldPerms);
        setModulePermissions(modulePerms);
        setEnabledModules(enabled);
        setEnabledSections(sectionEnabled);
        setOriginalPermissions({ 
          fieldPermissions: initialFieldPerms, 
          modulePermissions: modulePerms,
          enabledModules: enabled,
          enabledSections: sectionEnabled
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

  const toggleModuleEnabled = (module) => {
    const newEnabled = !enabledModules[module];
    setEnabledModules(prev => ({
      ...prev,
      [module]: newEnabled
    }));
    
    // If disabling, revoke all permissions and disable all sections
    if (!newEnabled) {
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
      // Disable all sections in this module
      const sections = MODULE_FIELDS[module]?.sections || {};
      setEnabledSections(prev => ({
        ...prev,
        [module]: Object.keys(sections).reduce((acc, s) => ({ ...acc, [s]: false }), {})
      }));
      setAllFieldsInModule(module, 'hidden');
      if (activeModule === module) {
        setActiveModule(null);
      }
    } else {
      // If enabling, grant read by default and enable all sections
      setModulePermissions(prev => ({
        ...prev,
        [module]: {
          ...prev[module],
          read: true
        }
      }));
      // Enable all sections in this module
      const sections = MODULE_FIELDS[module]?.sections || {};
      setEnabledSections(prev => ({
        ...prev,
        [module]: Object.keys(sections).reduce((acc, s) => ({ ...acc, [s]: true }), {})
      }));
      setAllFieldsInModule(module, 'view');
    }
  };

  const toggleSectionEnabled = (module, sectionKey) => {
    const newEnabled = !enabledSections[module]?.[sectionKey];
    setEnabledSections(prev => ({
      ...prev,
      [module]: {
        ...prev[module],
        [sectionKey]: newEnabled
      }
    }));
    
    // Update field permissions based on section enabled state
    if (newEnabled) {
      setAllFieldsInSection(module, sectionKey, 'view');
    } else {
      setAllFieldsInSection(module, sectionKey, 'hidden');
    }
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
    // Enable all sections
    const sections = MODULE_FIELDS[module]?.sections || {};
    setEnabledSections(prev => ({
      ...prev,
      [module]: Object.keys(sections).reduce((acc, s) => ({ ...acc, [s]: true }), {})
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
    // Disable all sections
    const sections = MODULE_FIELDS[module]?.sections || {};
    setEnabledSections(prev => ({
      ...prev,
      [module]: Object.keys(sections).reduce((acc, s) => ({ ...acc, [s]: false }), {})
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
      
      // Build nested permission structure for database
      const nestedPermissions = {
        modules: {}
      };
      
      // Also maintain flat array for backward compatibility
      const permissionsArray = [];
      
      Object.keys(MODULE_FIELDS).forEach(moduleKey => {
        const moduleDef = MODULE_FIELDS[moduleKey];
        const isModuleEnabled = enabledModules[moduleKey];
        const modulePerms = modulePermissions[moduleKey] || {};
        
        // Build nested structure
        nestedPermissions.modules[moduleKey] = {
          enabled: isModuleEnabled,
          name: moduleDef.name,
          category: moduleDef.category,
          crud: {
            read: !!modulePerms.read,
            create: !!modulePerms.create,
            update: !!modulePerms.update,
            delete: !!modulePerms.delete,
            export: !!modulePerms.export,
            import: !!modulePerms.import
          },
          sections: {}
        };
        
        // Add sections with their fields
        const sections = moduleDef.sections || {};
        Object.keys(sections).forEach(sectionKey => {
          const sectionDef = sections[sectionKey];
          const isSectionEnabled = enabledSections[moduleKey]?.[sectionKey];
          const fields = sectionDef.fields || {};
          
          nestedPermissions.modules[moduleKey].sections[sectionKey] = {
            enabled: isSectionEnabled,
            name: sectionDef.name,
            fields: {}
          };
          
          // Add field permissions
          Object.keys(fields).forEach(fieldKey => {
            const fieldPerm = fieldPermissions[moduleKey]?.[fieldKey] || 'hidden';
            nestedPermissions.modules[moduleKey].sections[sectionKey].fields[fieldKey] = {
              label: fields[fieldKey].label,
              permission: fieldPerm,
              sensitive: fields[fieldKey].sensitive || false
            };
          });
        });
        
        // Build flat array for backward compatibility
        if (isModuleEnabled) {
          if (modulePerms.read) permissionsArray.push(`${moduleKey}:read`);
          if (modulePerms.create) permissionsArray.push(`${moduleKey}:create`);
          if (modulePerms.update) permissionsArray.push(`${moduleKey}:update`);
          if (modulePerms.delete) permissionsArray.push(`${moduleKey}:delete`);
          if (modulePerms.export) permissionsArray.push(`${moduleKey}:export`);
          if (modulePerms.import) permissionsArray.push(`${moduleKey}:import`);
        }
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
          field_permissions: nestedPermissions  // Now saves the full nested structure
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
        
        setOriginalPermissions({ fieldPermissions, modulePermissions, enabledModules, enabledSections });
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

  // Show loading until everything is ready - prevents UI glitch
  if (!isReady || rbacLoading || loading) {
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

  const currentModule = activeModule ? MODULE_FIELDS[activeModule] : null;
  const enabledCount = Object.values(enabledModules).filter(Boolean).length;

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
                  <span>User Permissions</span>
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
          {/* Module List - Left Side */}
          <div className="w-80 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-full flex flex-col">
              <div className="p-4 bg-gray-50 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Modules</h3>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    {enabledCount} enabled
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Check modules to enable access</p>
              </div>
              
              <div className="p-3 overflow-y-auto flex-1">
                {/* Main Modules */}
                <div className="mb-4">
                  <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Main Modules
                  </div>
                  <div className="space-y-1">
                    {Object.keys(MODULE_FIELDS).filter(m => MODULE_FIELDS[m].category === 'module').map(module => {
                      const moduleDef = MODULE_FIELDS[module];
                      const isEnabled = enabledModules[module];
                      const isActive = activeModule === module;
                      const moduleCount = getModulePermCount(module);
                      
                      return (
                        <div
                          key={module}
                          className={`flex items-center p-3 rounded-lg transition-all cursor-pointer ${
                            isActive ? 'bg-blue-50 ring-2 ring-blue-500' : isEnabled ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleModuleEnabled(module)}
                            className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <div 
                            className="ml-3 flex-1"
                            onClick={() => isEnabled && setActiveModule(module)}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`font-medium text-sm ${isEnabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                {moduleDef.name}
                              </span>
                              {isEnabled && (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                  {moduleCount}/6
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{moduleDef.description}</p>
                          </div>
                          {isEnabled && (
                            <ChevronRightIcon className="h-4 w-4 text-gray-400 ml-2" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Masters */}
                <div className="mb-4">
                  <div className="px-2 py-1 text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2 bg-purple-50 rounded">
                    Masters
                  </div>
                  <div className="space-y-1">
                    {Object.keys(MODULE_FIELDS).filter(m => MODULE_FIELDS[m].category === 'master').map(module => {
                      const moduleDef = MODULE_FIELDS[module];
                      const isEnabled = enabledModules[module];
                      const isActive = activeModule === module;
                      const moduleCount = getModulePermCount(module);
                      
                      return (
                        <div
                          key={module}
                          className={`flex items-center p-3 rounded-lg transition-all cursor-pointer ${
                            isActive ? 'bg-purple-50 ring-2 ring-purple-500' : isEnabled ? 'bg-purple-50/50 hover:bg-purple-100' : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleModuleEnabled(module)}
                            className="h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                          />
                          <div 
                            className="ml-3 flex-1"
                            onClick={() => isEnabled && setActiveModule(module)}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`font-medium text-sm ${isEnabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                {moduleDef.name}
                              </span>
                              {isEnabled && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                  {moduleCount}/6
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{moduleDef.description}</p>
                          </div>
                          {isEnabled && (
                            <ChevronRightIcon className="h-4 w-4 text-gray-400 ml-2" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Financial Documents */}
                <div className="mb-4">
                  <div className="px-2 py-1 text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-2 bg-emerald-50 rounded">
                    Financial Documents
                  </div>
                  <div className="space-y-1">
                    {Object.keys(MODULE_FIELDS).filter(m => MODULE_FIELDS[m].category === 'financial').map(module => {
                      const moduleDef = MODULE_FIELDS[module];
                      const isEnabled = enabledModules[module];
                      const isActive = activeModule === module;
                      const moduleCount = getModulePermCount(module);
                      
                      return (
                        <div
                          key={module}
                          className={`flex items-center p-3 rounded-lg transition-all cursor-pointer ${
                            isActive ? 'bg-emerald-50 ring-2 ring-emerald-500' : isEnabled ? 'bg-emerald-50/50 hover:bg-emerald-100' : 'bg-gray-50 hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleModuleEnabled(module)}
                            className="h-4 w-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                          />
                          <div 
                            className="ml-3 flex-1"
                            onClick={() => isEnabled && setActiveModule(module)}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`font-medium text-sm ${isEnabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                {moduleDef.name}
                              </span>
                              {isEnabled && (
                                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                                  {moduleCount}/6
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{moduleDef.description}</p>
                          </div>
                          {isEnabled && (
                            <ChevronRightIcon className="h-4 w-4 text-emerald-400 ml-2" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Field-Level Permissions - Right Side */}
          <div className="flex-1 h-full">
            {!activeModule ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 h-full flex items-center justify-center">
                <div className="text-center p-8">
                  <ShieldCheckIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Module</h3>
                  <p className="text-gray-500 max-w-sm">
                    Check a module on the left to enable it, then click on it to configure field-level permissions.
                  </p>
                </div>
              </div>
            ) : !enabledModules[activeModule] ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 h-full flex items-center justify-center">
                <div className="text-center p-8">
                  <LockClosedIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Module Not Enabled</h3>
                  <p className="text-gray-500 max-w-sm mb-4">
                    Enable this module first to configure its permissions.
                  </p>
                  <button
                    onClick={() => toggleModuleEnabled(activeModule)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Enable {currentModule?.name}
                  </button>
                </div>
              </div>
            ) : currentModule && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 h-full flex flex-col overflow-hidden">
                {/* Module Header */}
                <div className="p-6 border-b border-gray-200 flex-shrink-0">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{currentModule.name}</h2>
                      <p className="text-gray-600 text-sm mt-1">{currentModule.description}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => grantFullAccess(activeModule)}
                        className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium"
                      >
                        Grant Full Access
                      </button>
                      <button
                        onClick={() => revokeAllAccess(activeModule)}
                        className="text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium"
                      >
                        Revoke All
                      </button>
                    </div>
                  </div>

                  {/* Module-level Permissions */}
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h3 className="font-medium text-gray-900 mb-3">Module Access (CRUD)</h3>
                    <div className="flex flex-wrap gap-2">
                      {['read', 'create', 'update', 'delete', 'export', 'import'].map(perm => (
                        <button
                          key={perm}
                          onClick={() => toggleModulePerm(activeModule, perm)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            modulePermissions[activeModule]?.[perm]
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-300 hover:bg-blue-50'
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
                  <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
                    <ListBulletIcon className="h-5 w-5 text-gray-500" />
                    <span>Field-Level Permissions</span>
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Enable fields using checkboxes to grant access, then configure sub-field permissions.
                  </p>
                  
                  {Object.entries(currentModule.sections || {}).map(([sectionKey, section]) => {
                    const isSectionEnabled = enabledSections[activeModule]?.[sectionKey];
                    const isExpanded = expandedSections[`${activeModule}-${sectionKey}`];
                    const fields = section.fields || {};
                    const enabledFieldCount = Object.keys(fields).filter(f => 
                      fieldPermissions[activeModule]?.[f] && fieldPermissions[activeModule][f] !== 'hidden'
                    ).length;
                    
                    return (
                      <div key={sectionKey} className={`border rounded-lg overflow-hidden transition-all ${
                        isSectionEnabled ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
                      }`}>
                        {/* Field (Section) Header with Checkbox */}
                        <div className="flex items-center p-4 bg-white border-b border-gray-100">
                          <input
                            type="checkbox"
                            checked={isSectionEnabled}
                            onChange={() => toggleSectionEnabled(activeModule, sectionKey)}
                            className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          />
                          <div className="ml-3 flex-1">
                            <div className="flex items-center justify-between">
                              <span className={`font-semibold ${isSectionEnabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                {section.name}
                              </span>
                              {isSectionEnabled && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                  {enabledFieldCount}/{Object.keys(fields).length} sub-fields
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {Object.keys(fields).length} sub-fields available
                            </p>
                          </div>
                          {isSectionEnabled && (
                            <button
                              onClick={() => toggleSection(`${activeModule}-${sectionKey}`)}
                              className="ml-2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDownIcon className="h-5 w-5 text-gray-400" />
                              ) : (
                                <ChevronRightIcon className="h-5 w-5 text-gray-400" />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Sub-Fields - Only shown when field (section) is enabled and expanded */}
                        {isSectionEnabled && isExpanded && (
                          <div className="p-4 bg-gray-50/50">
                            {/* Quick Actions for Sub-fields */}
                            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-200">
                              <span className="text-sm font-medium text-gray-700">Sub-field Permissions</span>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'edit')}
                                  className="text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium"
                                >
                                  All Edit
                                </button>
                                <button
                                  onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'view')}
                                  className="text-xs px-2.5 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium"
                                >
                                  All View
                                </button>
                                <button
                                  onClick={() => setAllFieldsInSection(activeModule, sectionKey, 'hidden')}
                                  className="text-xs px-2.5 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium"
                                >
                                  All Hide
                                </button>
                              </div>
                            </div>
                            
                            {/* Sub-field Grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                              {Object.entries(fields).map(([fieldKey, field]) => {
                                const currentPerm = fieldPermissions[activeModule]?.[fieldKey] || 'view';
                                const PermIcon = FIELD_PERMISSIONS[currentPerm]?.icon || EyeIcon;
                                
                                return (
                                  <div 
                                    key={fieldKey}
                                    className={`p-3 rounded-lg border bg-white ${FIELD_PERMISSIONS[currentPerm]?.color || 'border-gray-200'}`}
                                  >
                                    <div className="flex items-center space-x-2 mb-2">
                                      <PermIcon className={`h-4 w-4 ${
                                        currentPerm === 'edit' ? 'text-green-500' :
                                        currentPerm === 'view' ? 'text-blue-500' : 'text-red-500'
                                      }`} />
                                      <span className="font-medium text-gray-900 text-sm truncate" title={field.label}>
                                        {field.label}
                                      </span>
                                      {field.sensitive && (
                                        <LockClosedIcon className="h-3 w-3 text-amber-500 flex-shrink-0" title="Sensitive field" />
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
                          </div>
                        )}
                        
                        {/* Collapsed state message when enabled but not expanded */}
                        {isSectionEnabled && !isExpanded && (
                          <div className="px-4 py-2 bg-gray-50/50 text-sm text-gray-500">
                            Click expand to configure {Object.keys(fields).length} sub-field permissions
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Legend */}
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
