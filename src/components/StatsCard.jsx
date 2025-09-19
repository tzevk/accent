export default function StatsCard({ title, value, change, changeType = 'positive', icon: Icon, color = 'primary' }) {
  const colorClasses = {
    primary: 'border-accent-primary text-accent-primary',
    secondary: 'border-accent-secondary text-accent-secondary',
  };

  const changeClasses = {
    positive: 'text-green-600',
    negative: 'text-red-600',
    neutral: 'text-gray-600',
  };

  return (
    <div className={`bg-white rounded-lg shadow-lg p-6 border-l-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className={`text-lg font-semibold mb-2 ${colorClasses[color]}`}>
            {title}
          </h3>
          <p className="text-3xl font-bold text-gray-900 mb-2">
            {value}
          </p>
          {change && (
            <p className={`text-sm ${changeClasses[changeType]}`}>
              {change}
            </p>
          )}
        </div>
        {Icon && (
          <div className={`${colorClasses[color]}`}>
            <Icon className="h-8 w-8" />
          </div>
        )}
      </div>
    </div>
  );
}
