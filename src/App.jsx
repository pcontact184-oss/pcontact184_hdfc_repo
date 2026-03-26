import { useMemo, useState, useEffect, useRef } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { FaRocket } from "react-icons/fa";
import "./App.css";
import VideoBackground from "./VideoBackground";

const RAW_API_BASE = import.meta.env.VITE_API_BASE;
const API_KEY = import.meta.env.VITE_API_KEY;

// Remove trailing slash if present
const API_BASE = RAW_API_BASE?.replace(/\/+$/, "");

if (!API_BASE)
  throw new Error("VITE_API_BASE is missing. Check .env location and restart Vite.");
if (!API_KEY)
  throw new Error("VITE_API_KEY is missing. Check .env location and restart Vite.");

// One axios client so x-api-key always attached
const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
  },
});

function normalizeCsv(input) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sesCheck(email) {
  const res = await api.post("/ses/check", { email });
  return res.data;
}

async function otpVerify(email, otp) {
  const res = await api.post("/otp/verify", { email, otp });
  return res.data;
}

async function accountsList() {
  const res = await api.post("/accounts/list", {});
  return res.data;
}

async function regionsList(accountId) {
  const res = await api.post("/regions/list", { accountId });
  return res.data;
}

async function reportSend(payload) {
  const res = await api.post("/report/send", payload);
  return res.data;
}

export default function App() {
  const [emailsRaw, setEmailsRaw] = useState("");
  const [days, setDays] = useState("7");

  // accounts
  const [accounts, setAccounts] = useState([]); // [{id,name}]
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [allAccounts, setAllAccounts] = useState(false);


  const [primaryAccountId, setPrimaryAccountId] = useState("");
  // regions
  const [availableRegions, setAvailableRegions] = useState([]);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [allRegions, setAllRegions] = useState(true);

  const [emailStatus, setEmailStatus] = useState({
    state: "idle", // idle | loading | ok | bad | error
    details: [], // [{ email, ok, out }]
  });

  const [sendState, setSendState] = useState("idle"); // idle | otp | sending | success
  const [sendError, setSendError] = useState("");

  const [otp, setOtp] = useState("");
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [locked, setLocked] = useState(false);

  const emails = useMemo(() => normalizeCsv(emailsRaw), [emailsRaw]);
  const emailsValid = emails.length > 0 && emails.every((e) => isValidEmail(e));

  // First email is auth email for OTP verification
  const authEmail = emails[0] || "";
  const emailsCsv = emails.join(",");

  const emailsValidated =
    emailStatus.state === "ok" && emailStatus.details.length === emails.length;

  const daysNum = Number(days);
  const daysValid = Number.isFinite(daysNum) && daysNum > 0 && daysNum <= 90;

  const selectedAccountsEffective = allAccounts
    ? accounts.map((a) => a.id)
    : Array.from(new Set([primaryAccountId, ...selectedAccountIds].filter(Boolean)));

  const canEnableSend =
    !locked &&
    emailsValidated &&
    daysValid &&
    selectedAccountsEffective.length > 0 &&
    (allRegions || selectedRegions.length > 0);

  const notVerifiedEmails = useMemo(() => {
    if (!emailStatus.details?.length) return [];
    return emailStatus.details.filter((d) => !d.ok).map((d) => d.email);
  }, [emailStatus.details]);

  // Debounce SES check when emails change
  const debounceRef = useRef(null);

  useEffect(() => {
    async function init() {
      try {
        const out = await accountsList();
        const list = out?.accounts || [];
        setAccounts(list);

        // default select first account (if exists)
        if (list.length) {
          setSelectedAccountIds([list[0].id]);
          setPrimaryAccountId(list[0].id);
        }
      } catch (e) {
        setSendError(
          e?.response?.data?.message || e?.message || "Failed to load accounts"
        );
      }
    }
    init();
  }, []);

  // Load regions when selected account changes (use first selected account)
  useEffect(() => {
    async function loadRegions() {
      try {
        const accountId = primaryAccountId || "";
        if (!accountId) return;
        const out = await regionsList(accountId);
        const regions = out?.regions || [];
        setAvailableRegions(regions);

        // If allRegions = true, we don't need selections. If false, default select first 1
        if (!allRegions) {
          setSelectedRegions((prev) => {
            if (prev && prev.length) return prev.filter((r) => regions.includes(r));
            return regions.length ? [regions[0]] : [];
          });
        }
      } catch (e) {
        setSendError(
          e?.response?.data?.message || e?.message || "Failed to load regions"
        );
      }
    }
    loadRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryAccountId, allRegions]);

  useEffect(() => {
    // Auto SES validate with debounce
    setSendError("");

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!emailsRaw.trim()) {
      setEmailStatus({ state: "idle", details: [] });
      return;
    }

    if (!emailsValid) {
      setEmailStatus({ state: "error", details: [] });
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setEmailStatus({ state: "loading", details: [] });
      try {
        const results = [];
        for (const e of emails) {
          const out = await sesCheck(e);
          results.push({ email: e, ok: out?.exists === true, out });
        }
        const allOk = results.every((r) => r.ok);
        if (!allOk) {
          setEmailStatus({ state: "bad", details: results });
          return;
        }
        setEmailStatus({ state: "ok", details: results });
      } catch (err) {
        setEmailStatus({ state: "error", details: [] });
        setSendError(
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "Email check failed"
        );
      }
    }, 900);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [emailsRaw, emailsValid, emails]);

  function toggleAccount(id) {
    setSelectedAccountIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  function toggleRegion(region) {
    setSelectedRegions((prev) => {
      if (prev.includes(region)) return prev.filter((x) => x !== region);
      return [...prev, region];
    });
  }

  function handleSendClick() {
    setSendError("");
    setSendState("otp");
    setOtp("");
    setOtpAttempts(0);
    setLocked(false);
  }

  async function handleVerifyAndSend() {
    if (locked) return;

    setSendError("");

    if (!canEnableSend) {
      setSendError("Complete SES check + valid days + choose accounts/regions first.");
      return;
    }

    if (otpAttempts >= 3) {
      setLocked(true);
      setSendError("Session cancelled: OTP failed 3 times.");
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setSendError("Enter a valid 6-digit OTP.");
      return;
    }

    try {
      setSendState("sending");

      // 1) Verify OTP
      await otpVerify(authEmail, otp);

      // 2) Send report
      await reportSend({
        days: daysNum,

        // emails
        toEmails: emailsCsv,
        emails: emails,

        // accounts
        all_accounts: allAccounts,
        primaryAccountId: primaryAccountId || null,
        accountIds: selectedAccountsEffective,

        // regions
        all_regions: allRegions,
        regions: allRegions ? [] : selectedRegions,
      });

      setSendState("success");

      setTimeout(() => setSendState("idle"), 2000);
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.response?.data?.error || err?.message || "Failed";

      const nextAttempts = otpAttempts + 1;
      setOtpAttempts(nextAttempts);

      if (nextAttempts >= 3) {
        setLocked(true);
        setSendError("Session cancelled: OTP failed 3 times.");
      } else {
        setSendError(`OTP failed. Attempts: ${nextAttempts}/3. (${msg})`);
      }

      setSendState("otp");
    }
  }

  function resetAll() {
    setEmailsRaw("");
    setDays("7");
    setEmailStatus({ state: "idle", details: [] });
    setSendState("idle");
    setSendError("");
    setOtp("");
    setOtpAttempts(0);
    setLocked(false);

    setAllAccounts(false);
    if (accounts.length) setSelectedAccountIds([accounts[0].id]);

    setAllRegions(true);
    setSelectedRegions([]);
  }

  return (
    <div className="page">
      <VideoBackground />

      <motion.div
        className="card"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="logo-container">
          <img className="logo" src="/AutomateX_logo.png" alt="AutomateX Logo" />
        </div>

        <h2 className="headerText">HDFC - Security Report Dashboard</h2>

        <div className="section">
          <label className="label">1) Emails (comma separated)</label>
          <input
            className="input"
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            placeholder="Enter emails"
            disabled={locked}
          />

          {emailStatus.state === "loading" && <div>Checking SES…</div>}
          {emailStatus.state === "ok" && <div className="ok">All emails verified in SES.</div>}
          {emailStatus.state === "bad" && (
            <div className="err">Not verified in SES: {notVerifiedEmails.join(", ")}</div>
          )}
          {emailStatus.state === "error" && (
            <div className="err">SES check failed. Fix emails or try again.</div>
          )}
        </div>

        <div className="section">
          <label className="label">2) Accounts</label>

          <label style={{ display: "block", marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={allAccounts}
              onChange={(e) => setAllAccounts(e.target.checked)}
              disabled={!emailsValidated || locked}
            />{" "}
            All accounts
          </label>

          <div style={{ maxHeight: 120, overflow: "auto", opacity: allAccounts ? 0.5 : 1 }}>
            {accounts.map((a) => (
              <label key={a.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selectedAccountIds.includes(a.id)}
                  onChange={() => toggleAccount(a.id)}
                  disabled={allAccounts || !emailsValidated || locked}
                />{" "}
                {a.name} ({a.id})
              </label>
            ))}
          </div>
        </div>

        <div className="section">
          <label className="label">3) Days (1 - 90)</label>
          <input
            className="input"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="7"
            disabled={!emailsValidated || locked}
          />
          {!daysValid && days !== "" && <div className="err">Days must be between 1 and 90.</div>}
        </div>

        <div className="section">
          <label className="label">4) Regions</label>

          <label style={{ display: "block", marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={allRegions}
              onChange={(e) => setAllRegions(e.target.checked)}
              disabled={!emailsValidated || !daysValid || locked}
            />{" "}
            All regions
          </label>

          <div style={{ maxHeight: 140, overflow: "auto", opacity: allRegions ? 0.5 : 1 }}>
            {availableRegions.map((r) => (
              <label key={r} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selectedRegions.includes(r)}
                  onChange={() => toggleRegion(r)}
                  disabled={allRegions || !emailsValidated || !daysValid || locked}
                />{" "}
                {r}
              </label>
            ))}
          </div>

          {!allRegions && selectedRegions.length === 0 && (
            <div className="err">Select at least 1 region or choose All regions.</div>
          )}
        </div>

        <motion.button
          className="rocketButton"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSendClick}
          disabled={!canEnableSend}
        >
          <FaRocket /> Send Report
        </motion.button>

        <motion.button
          className="clearButton"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={resetAll}
        >
          CLR
        </motion.button>

        {sendState === "otp" && (
          <div className="otpBox">
            <input
              className="input"
              value={otp}
              onChange={(e) => setOtp(e.target.value.trim())}
              placeholder="6-digit OTP"
              disabled={locked}
            />
            <motion.button
              className="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleVerifyAndSend}
              disabled={locked}
            >
              Verify OTP & Send
            </motion.button>
            <div>Attempts used: {otpAttempts}/3</div>
          </div>
        )}

        {sendState === "sending" && (
          <motion.div
            className="loader"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          />
        )}

        {sendState === "success" && <div className="successCircle">Sent</div>}

        {sendError && <div className="err">{sendError}</div>}
      </motion.div>
    </div>
  );
}

