# Accent CRM

[![Next.js](https://img.shields.io/badge/Built%20With-Next.js-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![MySQL](https://img.shields.io/badge/Database-MySQL-4479A1?logo=mysql&logoColor=white)](https://mysql.com/)
[![React](https://img.shields.io/badge/Frontend-React-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)

Accent CRM is a comprehensive Customer Relationship Management system built with Next.js and MySQL. It provides a complete solution for managing leads, employees, projects, proposals, vendors, and company data with a modern, responsive interface.

## Features

- **Lead Management**: Track and manage leads with comprehensive information including contact details, project requirements, and follow-up activities
- **Employee Management**: Complete employee database with role-based access and detailed profiles
- **Project Management**: Create and track projects with timelines, manhour calculations, and price breakdowns
- **Proposal System**: Generate and manage proposals with detailed pricing and documentation
- **Vendor Management**: Maintain vendor database with contact information and service categories
- **Activity Tracking**: Monitor all activities and follow-ups across the system
- **Document Management**: Upload and organize documents related to leads, projects, and proposals
- **Dashboard Analytics**: Visual insights and statistics about your business operations

## Technology Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Backend**: Next.js API Routes, Node.js
- **Database**: MySQL 2 with connection pooling
- **UI Components**: Radix UI, Heroicons, Lucide React
- **Styling**: Tailwind CSS with custom components
- **File Processing**: ExcelJS for data import/export, PapaParse for CSV handling

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or above recommended)
- [MySQL](https://mysql.com/) database server
- [npm](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/) or [pnpm](https://pnpm.io/)

### Quick Setup

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd accent
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   The `.env.local` file should already be configured with your database credentials. If not, create it with:

   ```env
   DB_HOST=your-database-host
   DB_PORT=3306
   DB_NAME=your-database-name
   DB_USER=your-database-user
   DB_PASSWORD=your-database-password
   DB_CONNECT_TIMEOUT=10000
   DB_CONNECTION_LIMIT=10

   NEXTAUTH_SECRET=your-secret-key-here
   NEXTAUTH_URL=http://localhost:3000
   NODE_ENV=development
   ```

4. **Setup the database**

   ```bash
   npm run setup
   ```
   
   This script will:

   - Test database connection
   - Create the database if it doesn't exist
   - Run all necessary table migrations
   - Set up initial data structures


5. **Start the development server**

   ```bash
   npm run dev
   ```

6. **Access the application**
   
   Open [http://localhost:3000](http://localhost:3000) in your browser to view the CRM system.

### Authentication and protected routes

This project uses a simple cookie-based guard via Next.js Middleware to protect application routes.

- On successful login (`POST /api/login`), the server sets an `auth` httpOnly cookie.
- Middleware (`middleware.ts`) checks that cookie for all non-public paths and:
   - Redirects unauthenticated requests to `/signin?from=...` for page routes
   - Returns `401 Unauthorized` JSON for API routes
- A logout endpoint `POST /api/logout` clears the cookie.

Public paths allowed without authentication include `/signin`, `/_next/*`, assets like `/favicon.ico`, `/accent-logo.png`, and static uploads under `/uploads/*`.

Notes:
- This is a minimal presence-based cookie. For production, replace it with a signed cookie or JWT containing user identity/expiry and validate it in the middleware.
- To change which routes are public, edit the `publicPaths` list in `middleware.ts`.
### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build the application for production
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint for code quality
- `npm run setup` - Initialize database and backend setup
- `npm run clear-leads` - Clear leads data (development utility)

## Project Structure

```text
accent/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── api/               # API routes
│   │   ├── dashboard/         # Dashboard pages
│   │   ├── leads/             # Lead management
│   │   ├── employees/         # Employee management
│   │   ├── projects/          # Project management
│   │   ├── proposals/         # Proposal system
│   │   ├── vendors/           # Vendor management
│   │   └── masters/           # Master data management
│   ├── components/            # Reusable React components
│   └── utils/                # Utility functions and database
├── scripts/                   # Database and utility scripts
├── public/                    # Static assets
└── uploads/                   # File upload directory
```

## Database Schema

The system uses MySQL with the following main entities:

- **Employees**: Staff management with roles and permissions
- **Leads**: Customer leads with detailed information
- **Projects**: Project tracking and management
- **Proposals**: Business proposals and quotes
- **Vendors**: Vendor/supplier management
- **Activities**: System activity tracking
- **Documents**: File and document management

## Development

### Database Scripts

Additional utility scripts are available:

```bash
# Test database connection and tables
node check-table.js

# Import CSV lead data
node import-csv-leads.js

# Test API endpoints
node test-api.js

# Various database migration scripts in /scripts folder
```

### API Endpoints

The system provides RESTful APIs for all major entities:

- `/api/leads` - Lead management
- `/api/employees` - Employee operations
- `/api/projects` - Project management
- `/api/proposals` - Proposal handling
- `/api/vendors` - Vendor management
- `/api/activities` - Activity tracking
- `/api/companies` - Company management

## Deployment

For production deployment:

1. Set up a production MySQL database
2. Update environment variables for production
3. Build the application: `npm run build`
4. Start the production server: `npm start`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and commit them
4. Push to your fork and submit a pull request

## Support

For technical support or questions about the CRM system, please refer to the documentation files in the repository or create an issue.

## License

This project is proprietary software. All rights reserved.
