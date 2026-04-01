"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Mail, Phone, MapPin, Edit, Save, X, Navigation, Loader2 } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { indianStates, getAllStateNames } from "../../lib/data/indianStatesCities";
import { getCurrentLocation } from "../../lib/utils/geolocation";

interface UserInfo {
  name: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  address?: {
    line: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
}

export default function AccountPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<UserInfo>({
    name: "",
    email: "",
    phone: "",
    address: {
      line: "",
      city: "",
      state: "",
      pincode: "",
      country: "India",
    },
  });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login?redirect=/account");
      return;
    }

    // Fetch user info from API
    const fetchUserInfo = async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (res.ok) {
          const data = await res.json();
          const userInfo: UserInfo = {
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
            alternatePhone: "",
            address: data.address ? {
              line: data.address.line || "",
              city: data.address.city || "",
              state: data.address.state || "",
              pincode: data.address.pincode || "",
              country: data.address.country || "India",
            } : undefined,
          };
          setUserInfo(userInfo);
          setFormData(userInfo);
        } else {
          throw new Error("Failed to fetch user info");
        }
      } catch (error) {
        console.error("Error fetching user info:", error);
        // Use empty data on error
        const emptyUserInfo: UserInfo = {
          name: "",
          email: "",
          phone: "",
          alternatePhone: "",
          address: undefined,
        };
        setUserInfo(emptyUserInfo);
        setFormData(emptyUserInfo);
      } finally {
        setLoading(false);
      }
    };

    fetchUserInfo();
  }, [router, isAuthenticated]);

  // Note: City is now a free text input, so we don't need to filter cities based on state

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
          addressLine: formData.address?.line,
          city: formData.address?.city,
          state: formData.address?.state,
          pincode: formData.address?.pincode,
          country: formData.address?.country,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save profile");
      }

      const data = await res.json();
      // Update user info with saved data
      if (data.user) {
        const updatedUserInfo: UserInfo = {
          name: data.user.name,
          email: data.user.email,
          phone: data.user.phone,
          address: data.user.address ? {
            line: data.user.address.line || "",
            city: data.user.address.city || "",
            state: data.user.address.state || "",
            pincode: data.user.address.pincode || "",
            country: data.user.address.country || "India",
          } : undefined,
        };
        setUserInfo(updatedUserInfo);
        setFormData(updatedUserInfo);
      } else {
        setUserInfo(formData);
      }
      setEditing(false);
    } catch (error: any) {
      alert(`Failed to save profile: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (userInfo) {
      setFormData(userInfo);
    }
    setEditing(false);
  };

  const handleLocateMe = async () => {
    setLocating(true);
    try {
      const locationData = await getCurrentLocation();
      
      // Find matching state from Indian states
      let matchedState = "";
      if (locationData.state) {
        const stateMatch = indianStates.find(
          (state) =>
            state.name.toLowerCase().includes(locationData.state!.toLowerCase()) ||
            locationData.state!.toLowerCase().includes(state.name.toLowerCase())
        );
        if (stateMatch) {
          matchedState = stateMatch.name;
        }
      }

      const updatedAddress = {
        line: locationData.addressLine || formData.address?.line || "",
        city: locationData.city || formData.address?.city || "",
        state: matchedState || formData.address?.state || "",
        pincode: locationData.pincode || formData.address?.pincode || "",
        country: locationData.country || "India",
      };

      setFormData({
        ...formData,
        address: updatedAddress,
      });


      // Save location to backend if user is authenticated
      if (isAuthenticated && locationData.latitude && locationData.longitude) {
        try {
          const res = await apiFetch("/auth/save-location", {
            method: "POST",
            body: JSON.stringify({
              addressLine: updatedAddress.line,
              city: updatedAddress.city,
              state: updatedAddress.state,
              pincode: updatedAddress.pincode,
              country: updatedAddress.country,
              latitude: locationData.latitude,
              longitude: locationData.longitude,
            }),
          });

          if (!res.ok) {
            console.error("Failed to save location to backend");
          }
        } catch (error) {
          console.error("Error saving location:", error);
          // Don't show error to user, location is still filled in form
        }
      }
    } catch (error: any) {
      alert(`Failed to get location: ${error.message}`);
    } finally {
      setLocating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="animate-pulse bg-white rounded-xl shadow-sm p-8 h-96"></div>
        </div>
      </div>
    );
  }

  if (!userInfo) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 flex items-center">
          <User className="w-8 h-8 mr-3 text-emerald-600" />
          My Account
        </h1>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              Personal Information
            </h2>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-medium"
              >
                <Edit className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="w-4 h-4 inline mr-2" />
                Full Name
              </label>
              {editing ? (
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              ) : (
                <p className="text-gray-900">{userInfo.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Mail className="w-4 h-4 inline mr-2" />
                Email
              </label>
              {editing ? (
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              ) : (
                <p className="text-gray-900">{userInfo.email}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-2" />
                  Phone Number
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={formData.phone || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="9876543210"
                    maxLength={10}
                  />
                ) : (
                  <p className="text-gray-900">{userInfo.phone || "Not provided"}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-2" />
                  Alternate Phone (Optional)
                </label>
                {editing ? (
                  <input
                    type="tel"
                    value={formData.alternatePhone || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, alternatePhone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="9876543210"
                    maxLength={10}
                  />
                ) : (
                  <p className="text-gray-900">{userInfo.alternatePhone || "Not provided"}</p>
                )}
              </div>
            </div>
          </div>

          {editing && (
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 border border-gray-300 px-6 py-2 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <MapPin className="w-5 h-5 mr-2 text-emerald-600" />
              Address
            </h2>
            {editing && (
              <button
                onClick={handleLocateMe}
                disabled={locating}
                className="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50"
              >
                {locating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Locating...
                  </>
                ) : (
                  <>
                    <Navigation className="w-4 h-4" />
                    Locate Me
                  </>
                )}
              </button>
            )}
          </div>

          {userInfo.address ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Country
                </label>
                {editing ? (
                  <select
                    value={formData.address?.country || "India"}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        address: {
                          ...formData.address!,
                          country: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  >
                    <option value="India">India</option>
                  </select>
                ) : (
                  <p className="text-gray-900">{userInfo.address.country || "India"}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address Line
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.address?.line || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        address: {
                          ...formData.address!,
                          line: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="House/Flat No., Building Name, Street"
                  />
                ) : (
                  <p className="text-gray-900">{userInfo.address.line}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State *
                  </label>
                  {editing ? (
                    <select
                      value={formData.address?.state || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          address: {
                            ...formData.address!,
                            state: e.target.value,
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    >
                      <option value="">Select State</option>
                      {getAllStateNames().map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-gray-900">{userInfo.address.state}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    City *
                  </label>
                  {editing ? (
                    <input
                      type="text"
                      value={formData.address?.city || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          address: {
                            ...formData.address!,
                            city: e.target.value,
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="Enter city name"
                    />
                  ) : (
                    <p className="text-gray-900">{userInfo.address.city}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pincode
                </label>
                {editing ? (
                  <input
                    type="text"
                    value={formData.address?.pincode || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        address: {
                          ...formData.address!,
                          pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                        },
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="123456"
                    maxLength={6}
                  />
                ) : (
                  <p className="text-gray-900">{userInfo.address.pincode}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {editing ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Country
                    </label>
                    <select
                      value={formData.address?.country || "India"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          address: {
                            line: "",
                            city: "",
                            state: "",
                            pincode: "",
                            country: e.target.value,
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    >
                      <option value="India">India</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Address Line
                    </label>
                    <input
                      type="text"
                      value={formData.address?.line || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          address: {
                            ...formData.address!,
                            line: e.target.value,
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="House/Flat No., Building Name, Street"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        State *
                      </label>
                      <select
                        value={formData.address?.state || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            address: {
                              ...formData.address!,
                              state: e.target.value,
                              city: "",
                            },
                          })
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      >
                        <option value="">Select State</option>
                        {getAllStateNames().map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        City *
                      </label>
                      <input
                        type="text"
                        value={formData.address?.city || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            address: {
                              ...formData.address!,
                              city: e.target.value,
                            },
                          })
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        placeholder="Enter city name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Pincode
                    </label>
                    <input
                      type="text"
                      value={formData.address?.pincode || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          address: {
                            ...formData.address!,
                            pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="123456"
                      maxLength={6}
                    />
                  </div>
                </>
              ) : (
                <p className="text-gray-500">No address saved yet. Click Edit to add an address.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

