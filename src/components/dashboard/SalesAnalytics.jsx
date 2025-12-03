'use client';

import { useState, useEffect } from 'react';
import InteractiveDonut from '@/components/InteractiveDonut';

export default function SalesAnalytics({ period = 'Weekly' }) {
  const [salesData, setSalesData] = useState([]);
  const [salesTotals, setSalesTotals] = useState({ total: 0, conversion: 0 });
  const [salesMetric, setSalesMetric] = useState('count');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadSales = async (metricToUse) => {
      try {
        const url = `/api/analytics/sales?period=${encodeURIComponent(period)}&metric=${encodeURIComponent(metricToUse)}`;
        const res = await fetch(url);
        const json = await res.json();
        
        if (!mounted) return false;

        if (json?.success) {
          const arr = Array.isArray(json.data) ? json.data : [];
          const hasNonZero = arr.some(d => (Number(d.value) || 0) > 0);
          
          if (hasNonZero) {
            setSalesData(arr);
            setSalesTotals({ 
              total: Number(json.total) || 0, 
              conversion: Number(json.conversion) || 0 
            });
            return true;
          }
        }
      } catch (error) {
        console.error('Failed to load sales analytics:', error);
      }
      return false;
    };

    const load = async () => {
      setLoading(true);
      const ok = await loadSales(salesMetric);
      
      // Fallback to count if value metric has no data
      if (!ok && salesMetric === 'value') {
        const okCount = await loadSales('count');
        if (okCount && mounted) {
          setSalesMetric('count');
        }
      }
      
      if (!ok && mounted) {
        setSalesData([]);
        setSalesTotals({ total: 0, conversion: 0 });
      }
      
      if (mounted) setLoading(false);
    };

    load();
    return () => { mounted = false; };
  }, [period, salesMetric]);

  const formatINRCompact = (n, withSymbol = true) => {
    const num = Number(n) || 0;
    const abs = Math.abs(num);
    let value = num;
    let suffix = '';
    
    if (abs >= 1e7) {
      value = num / 1e7;
      suffix = 'Cr';
    } else if (abs >= 1e5) {
      value = num / 1e5;
      suffix = 'L';
    } else if (abs >= 1e3) {
      value = num / 1e3;
      suffix = 'K';
    }
    
    const fixed = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    const sign = num < 0 ? '-' : '';
    return `${withSymbol ? '₹' : ''}${sign}${fixed}${suffix}`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="h-80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Sales Pipeline</h3>
          <p className="text-sm text-gray-500 mt-1">{period} breakdown</p>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => setSalesMetric('count')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              salesMetric === 'count'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Count
          </button>
          <button
            onClick={() => setSalesMetric('value')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              salesMetric === 'value'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Value
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center">
        {salesData.length > 0 ? (
          <>
            <InteractiveDonut
              data={salesData}
              title={salesMetric === 'value' ? 'Total Value' : 'Total Count'}
              centerValue={
                salesMetric === 'value'
                  ? formatINRCompact(salesTotals.total)
                  : salesTotals.total.toLocaleString()
              }
            />
            
            {salesTotals.conversion > 0 && (
              <div className="mt-4 text-center">
                <p className="text-sm text-gray-600">
                  Conversion Rate:{' '}
                  <span className="font-semibold text-green-600">
                    {salesTotals.conversion.toFixed(1)}%
                  </span>
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="py-12 text-center text-gray-500">
            No sales data available for {period.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}
