"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";

type HelpTopic = "applications" | "evidence" | "review" | "findings" | "decisions" | "rules" | "accounts" | "audit";

interface HelpMessage {
  id: number;
  sender: "assistant" | "user";
  text: string;
  href?: string;
  linkLabel?: string;
  topic?: HelpTopic;
  quickReplies?: string[];
}

interface HelpReply {
  text: string;
  href?: string;
  linkLabel?: string;
  topic?: HelpTopic;
  quickReplies?: string[];
}

const TOPIC_KEYWORDS: Record<HelpTopic, RegExp> = {
  applications: /\b(application|applications|draft|start|create|apply|submission)\b/,
  evidence: /\b(upload|document|evidence|pdf|file|attach|processing|scan)\b/,
  review: /\b(queue|review|scrutiny|extraction|extracted fields|reviewer)\b/,
  findings: /\b(finding|findings|flag|issue|resolve|correct|correction|mismatch|discrepancy)\b/,
  decisions: /\b(status|track|decision|approved|rejected|report|outcome|submitted|pending|submit|submission)\b/,
  rules: /\b(rule|rules|compliance|source|simulate|simulation|proposal|regulation|clause)\b/,
  accounts: /\b(user|account|password|register|registration|institution account|access|administrator|admin|login|sign in)\b/,
  audit: /\b(audit|history|log|security|who changed)\b/,
};

function isInstitutionRole(role: string): boolean {
  return ["institution", "institution_login"].includes(role);
}

function getHelpReply(question: string, role: string, previousTopic?: HelpTopic): HelpReply {
  const query = question.trim().toLowerCase().replace(/[’‘]/g, "'");
  const normalizedQuery = query.replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
  const normalizedRole = role.trim().toLowerCase().replaceAll(" ", "_");
  const isInstitution = isInstitutionRole(normalizedRole);
  const isAdmin = ["admin", "administrator", "system_administrator"].includes(normalizedRole);
  const isComplianceAdmin = [
    "compliance_admin",
    "compliance_administrator",
    "regulatory_compliance_administrator",
  ].includes(normalizedRole);
  const greeting = /^(hi|hello|hey|hiya|good morning|good afternoon|good evening|howdy)( there)?( help)?$/i.test(normalizedQuery);
  const thanks = /^(thanks|thank you|thx|that helps|got it|great thanks)( so much)?$/i.test(normalizedQuery);
  const asksForHuman = /\b(human|person|support agent|administrator|admin help|contact support|talk to someone)\b/.test(normalizedQuery);

  if (greeting) {
    const roleName = displayRoleName(normalizedRole);
    return {
      text: `Hi${roleName ? `! I can help with your ${roleName} workspace` : "! I can help you get started"}.\n\nTell me what you're trying to do, or choose a question below. I can guide you through the steps, but I can't access or change your account or application records.`,
      quickReplies: getSuggestions(normalizedRole),
    };
  }

  if (thanks) {
    return { text: "You're welcome! What else can I help you with?", quickReplies: getSuggestions(normalizedRole) };
  }

  if (asksForHuman) {
    return {
      text: isInstitution
        ? "For account access, application-specific questions, or anything that needs a staff member, contact your institution's System Administrator or the Regula Shield administrator. I can't see your records or create support tickets."
        : "For account access or something that needs a staff decision, contact your System Administrator. I can't access records, change permissions, or create a support ticket.",
      topic: "accounts",
      quickReplies: ["How do I manage my account?", "How do I check an application?"],
    };
  }

  if (/\b(can you|could you|will you|please)\b.*\b(check|look up|find|see|open|change|update|submit|approve|reject|upload)\b/.test(normalizedQuery)) {
    return {
      text: "I can explain the steps, but I can't inspect or change your account or application records. Tell me what you're trying to do and I'll point you to the right place.",
      quickReplies: getSuggestions(normalizedRole),
    };
  }

  if (/\b(yes|yeah|yep|no|nope|not working|still not working|did not work|does not work|didn't help|did not help|not helpful|still stuck|what next|what now|more help|explain more|tell me more)\b/.test(normalizedQuery) && previousTopic) {
    return getTopicFollowUp(previousTopic, normalizedRole);
  }

  if (/\b(login|log in|sign in|signin|password|forgot password|reset password|locked out|can't access|cannot access)\b/.test(normalizedQuery)) {
    return {
      text: isInstitution
        ? "Sign in with the username and password you registered. A new Institution Applicant request must be approved by a System Administrator first. If you forgot your password or still can't access your account, contact the administrator—this chat can't reset passwords."
        : "Choose your assigned role, enter your personal username and password, and select Login. If your password is forgotten or your account is unavailable, contact the System Administrator; this chat can't reset passwords or change access.",
      topic: "accounts",
      href: "/",
      linkLabel: "Go to sign in",
      quickReplies: ["How do I request an institution account?", "How do I contact an administrator?"],
    };
  }

  if (/\b(request|register|registration)\b.*\b(account|access)\b|\b(institution account|new account)\b/.test(normalizedQuery)) {
    return {
      text: "Choose “Request an account” on the sign-in page, enter the applicant name, username, and a password, then submit the request. A System Administrator must approve it before the new account can sign in.",
      topic: "accounts",
      href: "/",
      linkLabel: "Go to sign in",
      quickReplies: ["How do I sign in?", "How do I contact an administrator?"],
    };
  }

  if (/\b(start|create|new application|apply|application form|draft|begin)\b/.test(normalizedQuery)) {
    if (!normalizedRole) {
      return {
        text: "To get started, sign in with your account. If you're an Institution Applicant and don't have an account yet, choose “Request an account” on the sign-in page; a System Administrator must approve it before you can sign in.",
        href: "/",
        linkLabel: "Go to sign in",
        topic: "applications",
        quickReplies: ["How do I sign in?", "How do I request an institution account?"],
      };
    }
    return isInstitution
      ? {
          text: "To start an application:\n1. Open My applications and choose New application.\n2. Enter the institution details and run the pre-submission check.\n3. Review any guidance, then create the draft.\n4. Open the draft to upload evidence. Once processing finishes, submit it for scrutiny.",
          href: "/",
          linkLabel: "Open my applications",
          topic: "applications",
          quickReplies: ["How do I upload evidence?", "What happens after I submit?"],
        }
      : {
          text: "Institution Applicants create drafts from My applications. Reviewers use their workspace queue to open submitted applications; they can't create applicant drafts from the review queue.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "applications",
          quickReplies: ["How do I review an application?", "How do I check application status?"],
        };
  }

  if (TOPIC_KEYWORDS.evidence.test(normalizedQuery)) {
    return isInstitution
      ? {
          text: "To add evidence, open a draft from My applications, go to its review page, and upload each document using the matching document type. Wait for every file to finish processing before submitting. If a file fails, check that it is a readable PDF and try again; contact your administrator if the problem continues.",
          href: "/",
          linkLabel: "Open my applications",
          topic: "evidence",
          quickReplies: ["What if my file fails?", "What happens after I submit?"],
        }
      : {
          text: "Open the application from your workspace to inspect its evidence and processing status. Wait for documents to finish processing before making a final decision. If a file failed, review its status and processing message on the application page.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "evidence",
          quickReplies: ["How do I review extracted fields?", "How do I resolve a finding?"],
        };
  }

  if (TOPIC_KEYWORDS.findings.test(normalizedQuery)) {
    return isInstitution
      ? {
          text: "If your application is returned for corrections, open it from My applications and read the review note. Update the application details or replace the relevant evidence, then resubmit it. If the request isn't clear, contact your administrator before changing information.",
          href: "/",
          linkLabel: "Open my applications",
          topic: "findings",
          quickReplies: ["How do I upload corrected evidence?", "How do I check a decision?"],
        }
      : {
          text: "Open the application and select a finding to read its explanation and compare the expected value with the source evidence. Authorized reviewers can correct an extracted value or resolve/dismiss a finding from that review page. Check the evidence first—review actions are recorded in the audit trail.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "findings",
          quickReplies: ["How do I review extracted fields?", "Where do I see the audit trail?"],
        };
  }

  if (TOPIC_KEYWORDS.rules.test(normalizedQuery)) {
    return isComplianceAdmin
      ? {
          text: "In Rule management, draft a rule for the relevant academic year, add its source and clause reference, verify the official source, and simulate it against a sample. Submit the proposal for independent System Administrator approval. A simulation is advisory and does not publish or apply the rule.",
          href: "/",
          linkLabel: "Open Rule management",
          topic: "rules",
          quickReplies: ["How does rule approval work?", "Where do I see the audit trail?"],
        }
      : {
          text: "Compliance checks use configured rules. Drafting proposals is limited to Compliance Administrators; a System Administrator independently reviews and approves a proposal before it is published. Verify official sources before relying on any rule.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "rules",
          quickReplies: ["How do I review an application?", "How do I contact an administrator?"],
        };
  }

  if (TOPIC_KEYWORDS.accounts.test(normalizedQuery)) {
    return isAdmin
      ? {
          text: "Open User administration to review institution account requests, create staff accounts, change roles, or enable and disable access. Review the selected user carefully before saving: role and access changes affect what that account can do.",
          href: "/",
          linkLabel: "Open User administration",
          topic: "accounts",
          quickReplies: ["How do I approve an institution request?", "Where do I see the audit trail?"],
        }
      : {
          text: isInstitution
            ? "Institution account requests need approval from a System Administrator before sign-in is enabled. For password resets or access problems, contact your administrator; this chat can't change account details."
            : "Your System Administrator manages staff accounts and passwords. Contact them for account or access changes; this chat can't change your account permissions.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "accounts",
          quickReplies: ["How do I contact an administrator?", "How do I sign in?"],
        };
  }

  if (TOPIC_KEYWORDS.audit.test(normalizedQuery)) {
    return isInstitution
      ? {
          text: "The audit trail is restricted to authorized staff. You can follow your own application's progress and open its decision report from My applications.",
          href: "/",
          linkLabel: "Open my applications",
          topic: "audit",
          quickReplies: ["How do I check a decision?", "How do I contact an administrator?"],
        }
      : {
          text: "Choose Audit trail from the workspace navigation to review recorded actions and verify the audit integrity status. The entries are read-only history; make changes from the relevant application or management page.",
          href: "/audit",
          linkLabel: "Open audit trail",
          topic: "audit",
          quickReplies: ["How do I resolve a finding?", "How do I manage accounts?"],
        };
  }

  if (TOPIC_KEYWORDS.decisions.test(normalizedQuery)) {
    return isInstitution
      ? {
          text: "Open My applications to see the current status. Once a decision is recorded, open the application report for the outcome, reviewer note, evidence summary, and findings. If corrections were requested, update the application and resubmit it.",
          href: "/",
          linkLabel: "Check my applications",
          topic: "decisions",
          quickReplies: ["How do I make corrections?", "How do I contact an administrator?"],
        }
      : {
          text: "Application statuses are listed in your workspace. Open a submission to review its details and evidence. Final decision actions are available only to authorized reviewers; decision reports and changes are recorded by the application workflow.",
          href: "/",
          linkLabel: "Open workspace",
          topic: "decisions",
          quickReplies: ["How do I review an application?", "Where do I see the audit trail?"],
        };
  }

  if (TOPIC_KEYWORDS.review.test(normalizedQuery)) {
    return isInstitution
      ? {
          text: "Open an application from My applications to follow its status and review notes. After you submit it, the scrutiny team checks the evidence and records the final decision. If corrections are requested, update the draft or evidence and resubmit.",
          href: "/",
          linkLabel: "View my applications",
          topic: "review",
          quickReplies: ["How do I check a decision?", "How do I make corrections?"],
        }
      : {
          text: "To review a submission:\n1. Open an application from your workspace queue.\n2. Check the institution details and document processing status.\n3. Compare extracted fields with the source documents and review validation findings.\n4. Resolve items within your role's permissions, then record or escalate the decision as appropriate.",
          href: "/",
          linkLabel: "Open review workspace",
          topic: "review",
          quickReplies: ["How do I resolve a finding?", "Where do I see the audit trail?"],
        };
  }

  if (TOPIC_KEYWORDS.applications.test(normalizedQuery)) {
    return isInstitution
        ? {
            text: "Open My applications to see your drafts and submitted applications. Select an application to continue editing a draft or check the status and review notes on a submission.",
            href: "/",
            linkLabel: "Open my applications",
            topic: "applications",
            quickReplies: ["How do I start an application?", "How do I check a decision?"],
          }
        : {
            text: "Your workspace lists the applications available to your role. Select one to open its details, evidence, and review history. What would you like to do with an application?",
            href: "/",
            linkLabel: "Open workspace",
            topic: "applications",
            quickReplies: ["How do I review an application?", "How do I check a decision?"],
          };
  }

  if (/\b(what can you do|what do you help with|help me|help|support|how does this work)\b/.test(normalizedQuery)) {
    return {
      text: "I can walk you through the workspace one step at a time. Ask me about starting an application, uploading a document, reviewing a finding, checking a decision, managing an account, or proposing a compliance rule. You can also tap one of the questions below.",
      quickReplies: getSuggestions(normalizedRole),
    };
  }

  return {
    text: "I’m not sure I understood that yet. Tell me what you're trying to do, or pick a topic and I'll guide you through the steps. For example, ask “How do I upload evidence?” or “What do I do with a finding?”\n\nI'm a built-in workflow guide, not a live AI agent, so I can't view your records or make changes.",
    quickReplies: getSuggestions(normalizedRole),
  };
}

function displayRoleName(role: string): string {
  if (isInstitutionRole(role)) return "Institution Applicant";
  if (["admin", "administrator", "system_administrator"].includes(role)) return "System Administrator";
  if (["compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role)) return "Compliance Administrator";
  if (["regulatory_officer", "regulatory", "verification_officer"].includes(role)) return "Regulatory Officer";
  if (["officer", "aicte_scrutiny_officer", "scrutiny_officer"].includes(role)) return "Scrutiny Officer";
  return "";
}

function getTopicFollowUp(topic: HelpTopic, role: string): HelpReply {
  const isInstitution = isInstitutionRole(role);
  const followUps: Record<HelpTopic, HelpReply> = {
    applications: {
      text: isInstitution
        ? "You can open My applications at any time to continue a draft. After you create one, open it to add evidence; after submitting, check that page for status or a correction request."
        : "Your workspace is the starting point. Select a listed application to open its details; the actions on that page depend on your role.",
      topic: "applications",
      href: "/",
      linkLabel: "Open workspace",
      quickReplies: ["How do I upload evidence?", "How do I check a decision?"],
    },
    evidence: {
      text: isInstitution
        ? "Make sure the file is a readable PDF, select the closest matching document type, and wait until processing is complete. If it still fails, note the error shown and contact your administrator."
        : "Check the document status and processing message on the application page. If it failed, the institution may need to upload a readable replacement.",
      topic: "evidence",
      quickReplies: ["How do I check application status?", "How do I contact an administrator?"],
    },
    review: {
      text: "Start with the application details, then compare extracted values against the source documents. Check open findings and processing status before taking an action; use the audit trail to verify a recorded change.",
      topic: "review",
      quickReplies: ["How do I resolve a finding?", "Where do I see the audit trail?"],
    },
    findings: {
      text: isInstitution
        ? "Only update what the review note asks for. Correct the application details or upload the right evidence, then resubmit. If the request isn't clear, ask your administrator before changing information."
        : "Read the finding and compare it with its source evidence before making a correction. If evidence doesn't support a correction, leave the finding open or escalate it. Changes are recorded in the audit trail.",
      topic: "findings",
      quickReplies: ["How do I review extracted fields?", "Where do I see the audit trail?"],
    },
    decisions: {
      text: isInstitution
        ? "The status in My applications shows where the submission is. An approved or rejected application has a report with the reviewer note and evidence summary. A correction request means you can update and resubmit it."
        : "Open the application to see its current status and review details. Only designated reviewers can record the final decision; check processing blockers and findings before proceeding.",
      topic: "decisions",
      quickReplies: ["How do I review an application?", "How do I make corrections?"],
    },
    rules: {
      text: "Rule simulations are advisory. Confirm the official source and clause, and remember that a proposed rule does not take effect until it has been independently approved and published.",
      topic: "rules",
      quickReplies: ["How do I propose a rule?", "Where do I see the audit trail?"],
    },
    accounts: {
      text: "For security, account changes and password resets must be handled by the System Administrator. Never share your password in this chat.",
      topic: "accounts",
      quickReplies: ["How do I contact an administrator?", "How do I sign in?"],
    },
    audit: {
      text: "The audit trail records actions; it doesn't provide a way to edit them. Open the relevant application or management page to make an authorized change.",
      topic: "audit",
      href: isInstitution ? "/" : "/audit",
      linkLabel: isInstitution ? "Open my applications" : "Open audit trail",
      quickReplies: ["How do I review an application?", "How do I resolve a finding?"],
    },
  };
  return followUps[topic];
}

function getSuggestions(role: string): string[] {
  if (isInstitutionRole(role)) {
    return ["How do I get started?", "How do I upload evidence?", "How do I check a decision?"];
  }
  if (["compliance_admin", "compliance_administrator", "regulatory_compliance_administrator"].includes(role)) {
    return ["How do I propose a rule?", "How do I review findings?", "Where is the audit trail?"];
  }
  if (["admin", "administrator", "system_administrator"].includes(role)) {
    return ["How do I manage accounts?", "How do I review applications?", "Where is the audit trail?"];
  }
  if (["officer", "aicte_scrutiny_officer", "scrutiny_officer", "regulatory_officer", "regulatory", "verification_officer"].includes(role)) {
    return ["How do I review an application?", "How do I resolve a finding?", "Where is the audit trail?"];
  }
  return ["How do I sign in?", "How do I request an account?", "What can you help me with?"];
}

export function HelpDesk({ displayName, role }: { displayName: string; role: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(0);
  const suggestions = getSuggestions(role.trim().toLowerCase().replaceAll(" ", "_"));

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [isOpen, messages]);

  function sendMessage(question: string) {
    const text = question.trim();
    if (!text) return;
    setMessages((current) => {
      const previousTopic = [...current].reverse().find((message) => message.sender === "assistant")?.topic;
      const reply = getHelpReply(text, role, previousTopic);
      return [
        ...current,
        { id: nextIdRef.current++, sender: "user", text },
        { id: nextIdRef.current++, sender: "assistant", ...reply },
      ];
    });
    setInput("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  function clearConversation() {
    setMessages([]);
    setInput("");
  }

  return (
    <div className="help-desk">
      {isOpen && (
        <section id="help-desk-panel" className="help-panel" aria-label="Help desk assistant">
          <header className="help-header">
            <div className="help-avatar"><Bot size={19} /></div>
            <div className="help-heading">
              <strong>Regula Guide</strong>
              <span><span className="help-online-dot" /> Instant workspace help</span>
            </div>
            {messages.length > 0 && <button className="help-close" type="button" onClick={clearConversation} aria-label="Clear conversation" title="Clear conversation"><RotateCcw size={16} /></button>}
            <button className="help-close" type="button" onClick={() => setIsOpen(false)} aria-label="Close help desk">
              <X size={18} />
            </button>
          </header>
          <div className="help-messages" role="log" aria-live="polite" aria-relevant="additions">
            <div className="help-greeting">
              <div className="help-greeting-title"><Sparkles size={15} /> Welcome, {displayName}</div>
              <p>Hi! Tell me what you need help with, and I’ll guide you step by step. I can’t view or change your records.</p>
            </div>
            {messages.map((message, index) => (
              <div className={`help-message help-message-${message.sender}`} key={message.id}>
                <p>{message.text}</p>
                {message.href && <Link href={message.href} onClick={() => setIsOpen(false)}>{message.linkLabel}</Link>}
                {message.sender === "assistant" && message.quickReplies && index === messages.length - 1 && (
                  <div className="help-follow-ups" aria-label="Suggested follow-up questions">
                    {message.quickReplies.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => sendMessage(suggestion)}>{suggestion}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {messages.length === 0 && (
            <div className="help-suggestions" aria-label="Suggested questions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => sendMessage(suggestion)}>{suggestion}</button>
              ))}
            </div>
          )}
          <form className="help-form" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="help-question">Ask the help desk</label>
            <input
              ref={inputRef}
              id="help-question"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a message…"
              maxLength={500}
            />
            <button type="submit" disabled={!input.trim()} aria-label="Send question"><Send size={17} /></button>
          </form>
          <p className="help-note">Built-in workspace guide · Messages stay in this browser</p>
        </section>
      )}
      <button
        className={`help-launcher${isOpen ? " help-launcher-open" : ""}`}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "Close help desk" : "Open help desk"}
        aria-expanded={isOpen}
      >
        {isOpen ? <X size={21} /> : <MessageCircle size={21} />}
        {!isOpen && <span>Help desk</span>}
      </button>
    </div>
  );
}
