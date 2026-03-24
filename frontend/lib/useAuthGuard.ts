"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";

export function useAuthGuard() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }
    // Verify token and check subscription is still active
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json();
      })
      .then((user) => {
        if (!["active", "trialing"].includes(user.subscription_status)) {
          localStorage.removeItem("token");
          router.replace("/?subscription=canceled");
        }
      })
      .catch(() => {
        localStorage.removeItem("token");
        router.replace("/login");
      });
  }, [router]);
}
