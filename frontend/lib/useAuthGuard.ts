"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";

const CACHE_KEY = "auth_ok";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function useAuthGuard() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    // Check session cache — skip the API call if we verified recently
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { ts, status } = JSON.parse(cached);
        if (
          Date.now() - ts < CACHE_TTL &&
          ["active", "trialing", "canceling"].includes(status)
        ) {
          return;
        }
      }
    } catch {
      // Ignore malformed cache
    }

    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json();
      })
      .then((user) => {
        if (!["active", "trialing", "canceling"].includes(user.subscription_status)) {
          localStorage.removeItem("token");
          sessionStorage.removeItem(CACHE_KEY);
          router.replace("/?subscription=canceled");
        } else {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ ts: Date.now(), status: user.subscription_status })
          );
        }
      })
      .catch(() => {
        localStorage.removeItem("token");
        sessionStorage.removeItem(CACHE_KEY);
        router.replace("/login");
      });
  }, [router]);
}
