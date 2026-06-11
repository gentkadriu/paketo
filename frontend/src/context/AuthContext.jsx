import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("paketo_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api("/auth/me")
      .then(setUser)
      .catch(() => localStorage.removeItem("paketo_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem("paketo_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (username, password) => {
    const data = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem("paketo_token", data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("paketo_token");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
