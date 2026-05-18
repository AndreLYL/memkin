# Example: Agent Session Extraction

## Input Conversation

```
[2024-01-15T10:00:00Z] → Alice: We need to migrate from sessions to JWT for the auth system
[2024-01-15T10:01:30Z] ← Bob: Makes sense for scaling. I can start this week.
[2024-01-15T10:02:15Z] → Alice: Perfect. Let's use the HS256 algorithm initially.
[2024-01-15T10:03:00Z] ← Bob: Got it. Should we add refresh tokens too?
[2024-01-15T10:03:45Z] → Alice: Yes, 7-day access tokens and 30-day refresh tokens.
[2024-01-15T10:04:30Z] ← Bob: I'll document the decision in the wiki before implementing.
```

## Output JSON

```json
{
  "source": {
    "platform": "slack",
    "channel": "#engineering",
    "timestamp": "2024-01-15T10:00:00Z",
    "thread_id": "thread-auth-migration",
    "raw_hash": "abc123def456",
    "quote": "We need to migrate from sessions to JWT for the auth system"
  },
  "entities": [
    {
      "slug": "person/alice",
      "name": "Alice",
      "type": "person",
      "context": "Engineering lead discussing auth migration",
      "confidence": "direct"
    },
    {
      "slug": "person/bob",
      "name": "Bob",
      "type": "person",
      "context": "Developer implementing JWT auth system",
      "confidence": "direct"
    },
    {
      "slug": "project/auth-system",
      "name": "Auth System",
      "type": "project",
      "context": "Authentication system being migrated to JWT",
      "confidence": "direct"
    },
    {
      "slug": "tool/jwt",
      "name": "JWT (JSON Web Tokens)",
      "type": "tool",
      "context": "Token-based authentication mechanism replacing sessions",
      "confidence": "direct"
    },
    {
      "slug": "concept/refresh-tokens",
      "name": "Refresh Tokens",
      "type": "concept",
      "context": "30-day tokens for obtaining new access tokens",
      "confidence": "direct"
    }
  ],
  "timeline": [
    {
      "date": "2024-01-15",
      "summary": "Decision to migrate from sessions to JWT authentication",
      "entities": ["person/alice", "person/bob", "project/auth-system", "tool/jwt"],
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:00:00Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "We need to migrate from sessions to JWT for the auth system"
      },
      "confidence": "direct"
    },
    {
      "date": "2024-01-15",
      "summary": "Bob commits to starting JWT migration this week",
      "entities": ["person/bob", "project/auth-system"],
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:01:30Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "Makes sense for scaling. I can start this week."
      },
      "confidence": "direct"
    }
  ],
  "links": [
    {
      "from": "person/bob",
      "to": "project/auth-system",
      "type": "works_on",
      "context": "Bob is implementing the JWT migration for auth system",
      "confidence": "direct"
    },
    {
      "from": "project/auth-system",
      "to": "tool/jwt",
      "type": "depends_on",
      "context": "Auth system will use JWT for token-based authentication",
      "confidence": "direct"
    },
    {
      "from": "person/alice",
      "to": "project/auth-system",
      "type": "works_on",
      "context": "Alice is leading the auth system migration decision",
      "confidence": "paraphrased"
    }
  ],
  "decisions": [
    {
      "summary": "Migrate authentication from sessions to JWT",
      "reasoning": "Better for scaling across multiple instances",
      "alternatives": ["Keep session-based auth", "Use OAuth2"],
      "entities": ["project/auth-system", "tool/jwt"],
      "date": "2024-01-15",
      "confidence": "direct",
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:00:00Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "We need to migrate from sessions to JWT for the auth system"
      }
    },
    {
      "summary": "Use HS256 algorithm for JWT signing",
      "entities": ["tool/jwt"],
      "date": "2024-01-15",
      "confidence": "direct",
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:02:15Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "Let's use the HS256 algorithm initially."
      }
    },
    {
      "summary": "Token expiration: 7-day access tokens, 30-day refresh tokens",
      "entities": ["tool/jwt", "concept/refresh-tokens"],
      "date": "2024-01-15",
      "confidence": "direct",
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:03:45Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "Yes, 7-day access tokens and 30-day refresh tokens."
      }
    }
  ],
  "tasks": [
    {
      "title": "Implement JWT-based authentication",
      "status": "open",
      "owner": "person/bob",
      "project": "project/auth-system",
      "valid_at": "2024-01-15T10:01:30Z",
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:01:30Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "I can start this week."
      },
      "confidence": "direct"
    },
    {
      "title": "Document JWT migration decision in wiki",
      "status": "open",
      "owner": "person/bob",
      "project": "project/auth-system",
      "valid_at": "2024-01-15T10:04:30Z",
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:04:30Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "I'll document the decision in the wiki before implementing."
      },
      "confidence": "direct"
    }
  ],
  "discoveries": [
    {
      "summary": "Session-based auth doesn't scale well across multiple instances",
      "type": "insight",
      "entities": ["project/auth-system"],
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:01:30Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "Makes sense for scaling."
      },
      "confidence": "paraphrased"
    },
    {
      "summary": "Document architectural decisions before implementation",
      "type": "procedure",
      "entities": ["person/bob"],
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:04:30Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "I'll document the decision in the wiki before implementing."
      },
      "confidence": "direct"
    }
  ]
}
```

## Key Takeaways from This Example

1. **Entity consistency**: Same person/project mentioned multiple times uses the same slug
2. **Confidence levels**: Most are "direct" (explicit), some "paraphrased" (clear implication)
3. **Rich context**: Each signal includes enough context to understand it standalone
4. **Quotes**: All under 300 chars, capturing the key statement
5. **Links**: Connect entities with specific relationship types
6. **Timeline**: Events ordered chronologically with clear summaries
7. **Decisions**: Capture not just what was decided, but why and what alternatives existed
8. **Tasks**: Include owner, status, and timing information
9. **Discoveries**: Extract both insights (learnings) and procedures (how-to)
