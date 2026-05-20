"use client";

import { Suspense } from "react";
import LoadingFallback from "@/components/LoadingFallback";
import EditProjectForm from "./EditProjectForm";

export default function EditProjectPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <EditProjectForm />
    </Suspense>
  );
}
