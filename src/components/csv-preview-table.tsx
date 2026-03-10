'use client'

import { type ImportRow, type ImportError, type ImportWarning } from '@/lib/csv/import'
import { Badge } from '@/components/ui/badge'

interface CSVPreviewProps {
  valid: ImportRow[]
  errors: ImportError[]
  warnings: ImportWarning[]
}

export function CSVPreviewTable({ valid, errors, warnings }: CSVPreviewProps) {
  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="border border-red-200 rounded-md p-3 bg-red-50">
          <p className="font-medium text-red-800 text-sm mb-2">Errors ({errors.length})</p>
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-red-700">Row {e.row}: {e.message}</p>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="border border-yellow-200 rounded-md p-3 bg-yellow-50">
          <p className="font-medium text-yellow-800 text-sm mb-2">Warnings ({warnings.length})</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-700">Row {w.row}: {w.message}</p>
          ))}
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-2">
          Valid rows: <Badge variant="secondary">{valid.length}</Badge>
        </p>
        {valid.length > 0 && (
          <div className="border rounded-md overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Age Group</th>
                  <th className="px-3 py-2 text-left">Level</th>
                  <th className="px-3 py-2 text-left">Competition</th>
                </tr>
              </thead>
              <tbody>
                {valid.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{row.competitor_number}</td>
                    <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                    <td className="px-3 py-2">{row.competitor_number}</td>
                    <td className="px-3 py-2">{row.age_group}</td>
                    <td className="px-3 py-2">{row.level}</td>
                    <td className="px-3 py-2">{row.competition_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
