import { XMarkIcon } from '@heroicons/react/24/outline';

export default function DocumentsIssuedTab({
  newIssuedDescRef,
  newIssuedDoc,
  setNewIssuedDoc,
  canEditProjectContent,
  projectActivityDocumentNameOptions,
  addIssuedDocument,
  documentsIssued,
  updateIssuedDocument,
  removeIssuedDocument,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-[#7F2487]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-sm font-bold text-gray-900">Documents Issued</h2>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Track documents issued to client
        </p>
      </div>

      <div className="px-6 py-5">
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
              <tr>
                <th className="text-center py-2 px-2 font-semibold text-gray-700">
                  Sr No
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Document Name
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Issued For
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Document Number
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Revision No.
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Issue Date
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Remarks
                </th>
                <th className="text-center py-2 px-2 font-semibold text-gray-700">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                <td className="py-2 px-2 text-center text-gray-400 font-semibold">
                  +
                </td>
                <td className="py-2 px-2">
                  <select
                    ref={newIssuedDescRef}
                    value={newIssuedDoc.document_name}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        document_name: e.target.value,
                      }))
                    }
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] bg-white"
                    disabled={!canEditProjectContent}
                  >
                    <option value="">Select Activity</option>
                    {projectActivityDocumentNameOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newIssuedDoc.issued_for}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        issued_for: e.target.value,
                      }))
                    }
                    placeholder="Issued For"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                    disabled={!canEditProjectContent}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newIssuedDoc.document_number}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        document_number: e.target.value,
                      }))
                    }
                    placeholder="Document No."
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                    disabled={!canEditProjectContent}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newIssuedDoc.revision_number}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        revision_number: e.target.value,
                      }))
                    }
                    placeholder="Revision"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                    disabled={!canEditProjectContent}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="date"
                    value={newIssuedDoc.issue_date}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        issue_date: e.target.value,
                      }))
                    }
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                    disabled={!canEditProjectContent}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newIssuedDoc.remarks}
                    onChange={(e) =>
                      setNewIssuedDoc((prev) => ({
                        ...prev,
                        remarks: e.target.value,
                      }))
                    }
                    placeholder="Remarks"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                    disabled={!canEditProjectContent}
                  />
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    type="button"
                    onClick={addIssuedDocument}
                    disabled={
                      !(
                        newIssuedDoc.document_name &&
                        newIssuedDoc.document_name.trim()
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newIssuedDoc.document_name && newIssuedDoc.document_name.trim() ? 'bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                    title="Add document"
                  >
                    Add
                  </button>
                </td>
              </tr>
              {documentsIssued.map((d, index) => (
                <tr
                  key={d.id}
                  className="hover:bg-gray-50 transition-colors align-top"
                >
                  <td className="py-2 px-2 text-center">{index + 1}</td>
                  <td className="py-2 px-2">
                    <select
                      value={d.document_name || ''}
                      onChange={(e) =>
                        updateIssuedDocument(
                          d.id,
                          'document_name',
                          e.target.value
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487] bg-white"
                      disabled={!canEditProjectContent}
                    >
                      <option value="">Select Activity</option>
                      {d.document_name &&
                        !projectActivityDocumentNameOptions.includes(
                          d.document_name
                        ) && (
                          <option value={d.document_name}>
                            {d.document_name}
                          </option>
                        )}
                      {projectActivityDocumentNameOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.issued_for || ''}
                      onChange={(e) =>
                        updateIssuedDocument(d.id, 'issued_for', e.target.value)
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                      disabled={!canEditProjectContent}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.document_number || ''}
                      onChange={(e) =>
                        updateIssuedDocument(
                          d.id,
                          'document_number',
                          e.target.value
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                      disabled={!canEditProjectContent}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.revision_number || ''}
                      onChange={(e) =>
                        updateIssuedDocument(
                          d.id,
                          'revision_number',
                          e.target.value
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                      disabled={!canEditProjectContent}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="date"
                      value={d.issue_date || ''}
                      onChange={(e) =>
                        updateIssuedDocument(d.id, 'issue_date', e.target.value)
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                      disabled={!canEditProjectContent}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.remarks || ''}
                      onChange={(e) =>
                        updateIssuedDocument(d.id, 'remarks', e.target.value)
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                      disabled={!canEditProjectContent}
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeIssuedDocument(d.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Remove document"
                      disabled={!canEditProjectContent}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
