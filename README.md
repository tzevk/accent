# Accent - Lead Management System

A modern lead management system built with Next.js 15, featuring a comprehensive dashboard for managing business leads with tabbed interface, Excel import/export capabilities, and full CRUD operations.

## 🚀 Features

- **📊 Dashboard Interface** - Clean, modern UI with navigation and statistics
- **📋 Lead Management** - Complete CRUD operations for lead data
- **📁 Tabbed Interface** - Switch between leads list and add lead form
- **📤 Excel Import/Export** - Upload leads via CSV/Excel files and download templates
- **🔍 Search & Filter** - Find leads by company name, status, city, etc.
- **📱 Responsive Design** - Works on desktop and mobile devices
- **🎯 Action Buttons** - View, Edit, and Delete operations with icon-based UI
- **📈 Statistics Cards** - Real-time stats for total, active, and won leads

## 🛠️ Tech Stack

- **Frontend**: Next.js 15.5.3 with Turbopack
- **Styling**: Tailwind CSS
- **Icons**: Heroicons
- **Database**: MySQL with mysql2
- **Environment**: Node.js with dotenv

## 📦 Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd accent
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file with your database configuration:
```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password
```

4. Set up the database:
```bash
node setup-leads.js
```

## 🚀 Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
