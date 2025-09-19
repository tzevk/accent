import Navbar from './Navbar';

export default function Layout({ children, title, subtitle, containerMode = false }) {
  if (containerMode) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
        <Navbar />
        {/* Fixed header section */}
        <div className="flex-shrink-0 pt-24 px-8 pb-4">
          {(title || subtitle) && (
            <div className="mb-6">
              {title && (
                <h1 className="text-3xl font-bold text-accent-primary mb-2">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="text-gray-600">
                  {subtitle}
                </p>
              )}
            </div>
          )}
        </div>
        {/* Scrollable content container */}
        <div className="flex-1 px-8 pb-4 overflow-hidden">
          <div className="h-full overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 relative">
      <Navbar />
      {/* Add top padding to account for fixed navbar */}
      <main className="pt-24 px-8 pb-4">
        <div>
          {(title || subtitle) && (
            <div className="mb-6">
              {title && (
                <h1 className="text-3xl font-bold text-accent-primary mb-2">
                  {title}
                </h1>
              )}
              {subtitle && (
                <p className="text-gray-600">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
