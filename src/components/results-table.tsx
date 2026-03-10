interface ResultRow {
  final_rank: number
  dancers: { first_name: string; last_name: string } | null
  calculated_payload: { average_score?: number } | null
}

export function ResultsTable({ results }: { results: ResultRow[] }) {
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="feis-thead">
          <tr>
            <th className="px-4 py-2 text-left w-16">Place</th>
            <th className="px-4 py-2 text-left">Dancer</th>
            <th className="px-4 py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody className="feis-tbody">
          {results.map((r, i) => (
            <tr key={i} className="border-t">
              <td className={`px-4 py-2 font-bold ${r.final_rank === 1 ? 'feis-place-1' : r.final_rank === 2 ? 'feis-place-2' : r.final_rank === 3 ? 'feis-place-3' : ''}`}>{r.final_rank}</td>
              <td className="px-4 py-2">
                {r.dancers?.first_name} {r.dancers?.last_name}
              </td>
              <td className="px-4 py-2 text-right">
                {r.calculated_payload?.average_score?.toFixed(1) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
