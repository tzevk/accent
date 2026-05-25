import { DocumentIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { normalizeDate } from "@/utils/date";

export default function DocumentsReceivedTab({
  newReceivedDoc,
  setNewReceivedDoc,
  newReceivedDescRef,
  addReceivedDocument,
  documentsReceived,
  updateReceivedDocument,
  removeReceivedDocument,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center gap-2">
          <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
          <h2 className="text-sm font-bold text-gray-900">
            List of Documents Received
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Record documents received with details
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
                  Date
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Description / Document Name
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Drawing Number
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Revision Number
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Unit / Qty
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Sent By
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
                  <input
                    type="date"
                    value={normalizeDate(
                      newReceivedDoc.date_received,
                    )}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        date_received: normalizeDate(
                          e.target.value,
                        ),
                      }))
                    }
                    placeholder="Date"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    ref={newReceivedDescRef}
                    type="text"
                    value={newReceivedDoc.description}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Document Name"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newReceivedDoc.drawing_number}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        drawing_number: e.target.value,
                      }))
                    }
                    placeholder="Drawing No."
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newReceivedDoc.revision_number}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        revision_number: e.target.value,
                      }))
                    }
                    placeholder="Rev. No."
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newReceivedDoc.unit_qty}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        unit_qty: e.target.value,
                      }))
                    }
                    placeholder="Unit/Qty"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newReceivedDoc.document_sent_by}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        document_sent_by: e.target.value,
                      }))
                    }
                    placeholder="Sent By"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newReceivedDoc.remarks}
                    onChange={(e) =>
                      setNewReceivedDoc((prev) => ({
                        ...prev,
                        remarks: e.target.value,
                      }))
                    }
                    placeholder="Remarks"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    type="button"
                    onClick={addReceivedDocument}
                    disabled={
                      !(
                        newReceivedDoc.description &&
                        newReceivedDoc.description.trim()
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newReceivedDoc.description && newReceivedDoc.description.trim() ? "bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                    title="Add document"
                  >
                    Add
                  </button>
                </td>
              </tr>
              {documentsReceived.map((d, index) => (
                <tr
                  key={d.id}
                  className="hover:bg-gray-50 transition-colors align-top"
                >
                  <td className="py-2 px-2 text-center">
                    {index + 1}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="date"
                      value={normalizeDate(d.date_received)}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "date_received",
                          normalizeDate(e.target.value),
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.description || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "description",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.drawing_number || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "drawing_number",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.revision_number || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "revision_number",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.unit_qty || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "unit_qty",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.document_sent_by || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "document_sent_by",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={d.remarks || ""}
                      onChange={(e) =>
                        updateReceivedDocument(
                          d.id,
                          "remarks",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeReceivedDocument(d.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Remove document"
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
