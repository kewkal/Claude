"use client";

import { useState } from "react";
import { Search, TrendingUp, FileText, AlertCircle, ChevronUp, ChevronDown, DollarSign, BarChart2, Target } from "lucide-react";
import type { KeywordResult, AdResult, SortField, SortDir } from "./lib/types";

export default function Home() {
  const [domain, setDomain] = useState("");
  const [activeTab, setActiveTab] = useState<"keywords" | "ads">("keywords");
  const [keywords, setKeywords] = useState<KeywordResult[]>([]);
  const [ads, setAds] = useState<AdResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchedDomain, setSearchedDomain] = useState("");
  const [sortField, setSortField] = useState<SortField>("searchVolume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*/, "");
    if (!clean) return;

    setLoading(true);
    setError("");
    setSearched(false);

    try {
      const [kwRes, adRes] = await Promise.all([
        fetch("/api/dataforseo/keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: clean }),
        }),
        fetch("/api/dataforseo/ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: clean }),
        }),
      ]);

      const kwData = await kwRes.json();
      const adData = await adRes.json();

      if (kwData.error) throw new Error(kwData.error);
      if (adData.error) throw new Error(adData.error);

      setKeywords(kwData.keywords ?? []);
      setAds(adData.ads ?? []);
      setSearchedDomain(clean);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const filteredKeywords = keywords
    .filter((k) => k.keyword.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      return sortDir === "asc" ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
    });

  const filteredAds = ads.filter(
    (a) =>
      a.keyword.toLowerCase().includes(filter.toLowerCase()) ||
      a.headline.toLowerCase().includes(filter.toLowerCase())
  );

  const totalSpend = keywords.reduce((sum, k) => sum + k.cpc * k.searchVolume * 0.01, 0);
  const avgCpc = keywords.length ? keywords.reduce((s, k) => s + k.cpc, 0) / keywords.length : 0;

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-gray-300" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 text-blue-500" />
    ) : (
      <ChevronDown className="w-3 h-3 text-blue-500" />
    );
  }

  function CompetitionBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color = pct > 70 ? "bg-red-500" : pct > 40 ? "bg-yellow-500" : "bg-green-500";
    return (
      <div className="flex items-center gap-2">
        <div className="w-20 bg-gray-100 rounded-full h-1.5">
          <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-gray-500">{pct}%</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-600" />
            <span className="text-xl font-bold text-gray-900">PPCSpy</span>
          </div>
        </div>
      </header>

      {/* Hero search */}
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Spy on Any Competitor&apos;s PPC Strategy</h1>
          <p className="text-blue-200 mb-8 text-sm">Enter a competitor&apos;s domain to uncover their paid keywords, ad copy, and spend estimates.</p>
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="competitor.com"
                className="w-full pl-9 pr-4 py-3 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !domain.trim()}
              className="bg-blue-500 hover:bg-blue-400 disabled:bg-blue-800 text-white px-6 py-3 rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
            >
              {loading ? "Searching…" : "Spy Now"}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 mb-6 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {searched && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { icon: <TrendingUp className="w-5 h-5 text-blue-600" />, label: "PPC Keywords", value: keywords.length.toLocaleString() },
                { icon: <FileText className="w-5 h-5 text-purple-600" />, label: "Ad Variations", value: ads.length.toLocaleString() },
                { icon: <DollarSign className="w-5 h-5 text-green-600" />, label: "Est. Monthly Spend", value: `$${(totalSpend / 1000).toFixed(1)}K` },
                { icon: <BarChart2 className="w-5 h-5 text-orange-600" />, label: "Avg. CPC", value: `$${avgCpc.toFixed(2)}` },
              ].map((stat) => (
                <div key={stat.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center gap-3">
                  <div className="p-2 bg-gray-50 rounded-lg">{stat.icon}</div>
                  <div>
                    <p className="text-xs text-gray-500">{stat.label}</p>
                    <p className="text-xl font-bold text-gray-900">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 px-4">
                <div className="flex">
                  {(["keywords", "ads"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {tab === "keywords" ? `PPC Keywords (${keywords.length})` : `Ad Copy (${ads.length})`}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 my-2 focus:outline-none focus:ring-2 focus:ring-blue-200 w-48"
                />
              </div>

              {activeTab === "keywords" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                        {[
                          { label: "Keyword", field: "keyword" as SortField },
                          { label: "Search Volume", field: "searchVolume" as SortField },
                          { label: "CPC", field: "cpc" as SortField },
                          { label: "Competition", field: "competition" as SortField },
                          { label: "Ad Position", field: "domain1Pos" as SortField },
                        ].map(({ label, field }) => (
                          <th
                            key={field}
                            className="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none"
                            onClick={() => toggleSort(field)}
                          >
                            <div className="flex items-center gap-1">
                              {label}
                              <SortIcon field={field} />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredKeywords.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                            No keywords found for <strong>{searchedDomain}</strong>
                          </td>
                        </tr>
                      ) : (
                        filteredKeywords.map((kw, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 font-medium text-gray-900">{kw.keyword}</td>
                            <td className="px-4 py-3 text-gray-700">{kw.searchVolume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-green-700 font-medium">${kw.cpc.toFixed(2)}</td>
                            <td className="px-4 py-3">
                              <CompetitionBar value={kw.competition} />
                            </td>
                            <td className="px-4 py-3">
                              {kw.domain1Pos !== null ? (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${kw.domain1Pos <= 2 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                                  #{kw.domain1Pos}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === "ads" && (
                <div className="divide-y divide-gray-100">
                  {filteredAds.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-400">
                      No ads found for <strong>{searchedDomain}</strong>
                    </div>
                  ) : (
                    filteredAds.map((ad, i) => (
                      <div key={i} className="px-6 py-5 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Ad</span>
                              <span className="text-xs text-green-700">{ad.displayUrl}</span>
                              {ad.position && (
                                <span className="text-xs text-gray-400">Position #{ad.position}</span>
                              )}
                            </div>
                            <p className="text-blue-700 font-medium text-base leading-snug mb-1">{ad.headline}</p>
                            <p className="text-gray-600 text-sm leading-relaxed">{ad.description}</p>
                          </div>
                          <div className="shrink-0">
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                              {ad.keyword}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {!searched && !loading && !error && (
          <div className="text-center py-16 text-gray-400">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Enter a competitor domain above to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
