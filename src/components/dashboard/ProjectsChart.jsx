'use client';

import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function ProjectsChart({ period = 'Weekly' }) {
  const [projectSeries, setProjectSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadProjects = async () => {
      try {
        const url = `/api/analytics/projects?period=${encodeURIComponent(period)}`;
        const res = await fetch(url);
        const json = await res.json();
        
        if (!mounted) return;

        if (json?.success) {
          setProjectSeries(Array.isArray(json.series) ? json.series : []);
        } else {
          setProjectSeries([]);
        }
      } catch (error) {
        console.error('Failed to load projects analytics:', error);
        if (mounted) setProjectSeries([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadProjects();
    return () => { mounted = false; };
  }, [period]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="h-80 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Projects Overview</h3>
        <p className="text-sm text-gray-500 mt-1">{period} progress</p>
      </div>

      <div className="h-80">
        {projectSeries.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={projectSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="label" 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '8px 12px'
                }}
                cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
              />
              <Bar 
                dataKey="value" 
                fill="#8b5cf6" 
                radius={[8, 8, 0, 0]}
                maxBarSize={60}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            No project data available for {period.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}
