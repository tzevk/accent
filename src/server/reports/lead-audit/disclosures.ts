import type { LeadAuditDisclosure } from './types';

/** The intake slice's coverage disclosures, shared by the view and evidence. */
export function buildLeadAuditDisclosures(
	missingEnquiryDate: number
): LeadAuditDisclosure[] {
	return [
		{
			code: 'system_entry',
			text: 'Leads recorded counts system entry by creation time. It includes imported Leads and is not verified enquiry arrival.',
		},
		{
			code: 'enquiry_date',
			text: 'Enquiries dated in period counts the stated Enquiry Date, which is editable. It is a separate population and never a substitute for system entry.',
		},
		{
			code: 'missing_enquiry_date',
			text: `${missingEnquiryDate} Lead(s) recorded in this period have no Enquiry Date. They stay in system entry and are excluded from Enquiry Date figures; system entry is never used in their place.`,
		},
		{
			code: 'deleted_leads',
			text: 'Soft-deleted Leads are excluded from every operational intake figure and from the Lead register. Retained deleted-record evidence is outside this intake view.',
		},
		{
			code: 'source_labels',
			text: 'Source values are stored free text. Labels are grouped exactly as stored, without case or whitespace normalization, and missing labels appear as Unknown source.',
		},
		{
			code: 'distinct_leads',
			text: 'Every total counts distinct Leads. The intake figures read the Lead row only, so activity or Proposal rows cannot multiply a Lead count.',
		},
		{
			code: 'live_data',
			text: 'Figures use live corrected facts and can change between two observations. The generation time and reporting time zone describe this observation only.',
		},
	];
}
