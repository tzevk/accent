import { DocumentIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { normalizeDate } from "@/utils/date";

export default function InputDocumentsTab({
  newInputDocument,
  setNewInputDocument,
  handleInputDocumentKeyPress,
  addInputDocument,
  inputDocumentsList,
  setInputDocumentsList,
  setForm,
  removeInputDocument,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center gap-2">
          <DocumentIcon className="h-4 w-4 text-[#7F2487]" />
          <h2 className="text-sm font-bold text-gray-900">
            Input Documents
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Manage project input documents and references
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
                  Category
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Lot/Sub-lot
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Date
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Description
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Drawing No.
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Sheet No.
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Revision
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Unit/Qty
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
              {/* Inline input row at top with purple background */}
              <tr className="bg-purple-25/30 border-b-2 border-purple-100">
                <td className="py-2 px-2 text-center text-gray-400 font-semibold">
                  +
                </td>
                <td className="py-2 px-2">
                  <select
                    value={newInputDocument.category}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        category: e.target.value,
                      }))
                    }
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  >
                    <option value="lot">Lot</option>
                    <option value="sublot">Sub-lot</option>
                    <option value="date">Date</option>
                    <option value="others">Others</option>
                  </select>
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={
                      newInputDocument.category === "lot"
                        ? newInputDocument.lotNumber || ""
                        : newInputDocument.category === "sublot"
                          ? newInputDocument.subLot || ""
                          : ""
                    }
                    onChange={(e) => {
                      if (newInputDocument.category === "lot") {
                        setNewInputDocument((prev) => ({
                          ...prev,
                          lotNumber: e.target.value,
                        }));
                      } else if (
                        newInputDocument.category === "sublot"
                      ) {
                        setNewInputDocument((prev) => ({
                          ...prev,
                          subLot: e.target.value,
                        }));
                      }
                    }}
                    placeholder={
                      newInputDocument.category === "lot"
                        ? "LOT-001"
                        : newInputDocument.category === "sublot"
                          ? "SL-001"
                          : "N/A"
                    }
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="date"
                    value={normalizeDate(
                      newInputDocument.date_received,
                    )}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        date_received: normalizeDate(
                          e.target.value,
                        ),
                      }))
                    }
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.description}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    onKeyPress={handleInputDocumentKeyPress}
                    placeholder="Description*"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.drawing_number}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        drawing_number: e.target.value,
                      }))
                    }
                    placeholder="DWG-XXX"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.sheet_number}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        sheet_number: e.target.value,
                      }))
                    }
                    placeholder="SH-001"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.revision_number}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        revision_number: e.target.value,
                      }))
                    }
                    placeholder="Rev-A"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.unit_qty}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        unit_qty: e.target.value,
                      }))
                    }
                    placeholder="10 pcs"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.document_sent_by}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        document_sent_by: e.target.value,
                      }))
                    }
                    placeholder="Sender"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newInputDocument.remarks}
                    onChange={(e) =>
                      setNewInputDocument((prev) => ({
                        ...prev,
                        remarks: e.target.value,
                      }))
                    }
                    placeholder="Notes"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    type="button"
                    onClick={addInputDocument}
                    disabled={
                      !(
                        newInputDocument.description &&
                        newInputDocument.description.trim()
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newInputDocument.description && newInputDocument.description.trim() ? "bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                    title="Add document"
                  >
                    Add
                  </button>
                </td>
              </tr>
              {inputDocumentsList.map((doc, index) => (
                <tr
                  key={doc.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-2 px-2 text-center text-gray-600 font-semibold">
                    {index + 1}
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={doc.category || "others"}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? { ...d, category: e.target.value }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    >
                      <option value="lot">Lot</option>
                      <option value="sublot">Sub-lot</option>
                      <option value="date">Date</option>
                      <option value="others">Others</option>
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={
                        doc.category === "lot"
                          ? doc.lotNumber || ""
                          : doc.category === "sublot"
                            ? doc.subLot || ""
                            : ""
                      }
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) => {
                            if (d.id === doc.id) {
                              if (doc.category === "lot")
                                return {
                                  ...d,
                                  lotNumber: e.target.value,
                                };
                              if (doc.category === "sublot")
                                return {
                                  ...d,
                                  subLot: e.target.value,
                                };
                            }
                            return d;
                          },
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      placeholder={
                        doc.category === "lot"
                          ? "LOT-001"
                          : doc.category === "sublot"
                            ? "SL-001"
                            : "N/A"
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="date"
                      value={normalizeDate(doc.date_received)}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  date_received: normalizeDate(
                                    e.target.value,
                                  ),
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.description || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  description: e.target.value,
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.drawing_number || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  drawing_number: e.target.value,
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.sheet_number || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  sheet_number: e.target.value,
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.revision_number || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  revision_number: e.target.value,
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.unit_qty || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? { ...d, unit_qty: e.target.value }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.document_sent_by || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? {
                                  ...d,
                                  document_sent_by:
                                    e.target.value,
                                }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={doc.remarks || ""}
                      onChange={(e) => {
                        const updated = inputDocumentsList.map(
                          (d) =>
                            d.id === doc.id
                              ? { ...d, remarks: e.target.value }
                              : d,
                        );
                        setInputDocumentsList(updated);
                        setForm((prev) => ({
                          ...prev,
                          input_document: JSON.stringify(updated),
                        }));
                      }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeInputDocument(doc.id)}
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
