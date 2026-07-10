# Backend Data & Objects — A Mental Map (and what to Google)

## The one insight that fixes the confusion

In uni, your **ERD** and **class diagram** looked like the same nouns in two formats
(User, Course, Enrollment...). That's because you were modeling a domain *abstractly*.

In a real backend, **the same concept ("User") shows up in several different shapes**,
because each *layer* of the app has a different job. DTO, Entity, DB Model, etc. are just
"User wearing a different hat" at different points in the request. Nothing was hidden from
you in uni — you just only saw one hat.

The umbrella topic name is: **Software / Application Architecture**, specifically
**Layered (n-tier) Architecture** + **Data Modeling**.

---

## The request flow (this is the skeleton everything hangs on)

```
Client (browser/app)
   │  JSON in/out
   ▼
Controller / Route / Handler      ← receives request, returns response
   │  DTO
   ▼
Service (business logic)          ← the actual rules of your app
   │  Domain object / Entity
   ▼
Repository / DAO                  ← talks to the database
   │  DB Model / Entity (via ORM)
   ▼
Database (tables)                 ← ERD describes THIS
```

Data changes shape as it moves up and down this pipe. That's the whole story.

---

## Glossary — the "hats" of one concept

| Term | What it is | Lives where | Described by |
|------|------------|-------------|--------------|
| **Table / Schema** | Actual DB structure: columns, types, PK/FK | Database | **ERD** |
| **Entity / DB Model / ORM Model** | A class in code that maps 1:1 to a table (via an ORM) | Repository layer | Class diagram |
| **Domain Entity / Domain Model** | A class holding business concepts + rules (may or may not equal the DB model) | Service/domain layer | Class diagram |
| **DTO (Data Transfer Object)** | The *shape of data crossing a boundary* — usually your API request/response JSON. A plain data bag, no logic. | Controller/API edge | Class diagram |
| **VO (Value Object)** | Small immutable value defined by its data, not an ID (e.g. Money, DateRange) | Domain layer | Class diagram |
| **Repository / DAO** | Object whose job is DB access (find, save, delete) | Data layer | Class diagram |
| **Service** | Object holding business logic; orchestrates repositories | Service layer | Class diagram |
| **Mapper** | Converts between shapes (Entity ⇄ DTO) | Between layers | Class diagram |

Key takeaway: an **ERD only ever describes tables**. A **class diagram can describe ANY
class in your code** — including DTOs and Services that never touch the database. That's why
a class diagram "has more things" than the ERD.

---

## ERD vs Class Diagram — the real difference

- **ERD** = *data model*. Boxes are tables. Lines are relationships (1-to-many etc.) via
  primary/foreign keys. No behavior. Tool of **database design**.
- **Class diagram** = *object model*. Boxes are classes with attributes **and methods**.
  Tool of **object-oriented design**. Can represent things with no DB table at all
  (DTOs, services, mappers).

They overlapped in uni because your class diagram only contained entity classes. Add
DTOs/services and they diverge.

---

## Why a DTO "suddenly" exists

You don't hand your raw database rows to the outside world, because:

1. **Security** — your `User` table has `password_hash`; the API response shouldn't.
2. **Decoupling** — if you rename a DB column, you don't want every client to break.
3. **Shaping** — the client wants `fullName`; the DB stores `first_name` + `last_name`.
4. **Combining** — one API response might merge data from 3 tables.

So the DTO is a *purpose-built shape for the API*, separate from the DB shape. A **Mapper**
converts between them.

---

## Your curriculum — topics + exact search terms

Learn these roughly in order. For a small academy project you only truly need 1–4.

1. **Data Modeling**
   - "conceptual vs logical vs physical data model"
   - "database normalization 1NF 2NF 3NF"
   - "primary key foreign key relationships"

2. **ORM (Object-Relational Mapping)** — the bridge between tables and classes
   - "what is an ORM"
   - search your stack's ORM: Prisma / Sequelize / TypeORM (Node), Hibernate/JPA (Java),
     SQLAlchemy (Python), Entity Framework (C#)
   - "database migrations"

3. **Layered / N-tier Architecture** ← the big missing word for you
   - "three tier architecture"
   - "controller service repository pattern"
   - "separation of concerns"

4. **DTO & API design**
   - "data transfer object pattern"
   - "why use DTOs"
   - "REST API design best practices"
   - "serialization / deserialization"

5. **Design patterns (data-related)**
   - "Repository pattern", "DAO pattern", "Mapper pattern"

6. **Domain-Driven Design (DDD)** — *optional / advanced; skip for a small project*
   - "DDD entities value objects aggregates"
   - This is where "Domain Entity ≠ Database Model" comes from. In big systems people keep
     them separate. In small ones you merge them (see below).

---

## Practical advice for a SMALL project (don't over-engineer)

- **Merge Domain Entity + DB Model into one ORM model.** Keeping them separate is a
  big-app / DDD thing; for an academy project it's just extra work.
- **Add a DTO only where the API shape actually differs from the DB shape** (hiding fields,
  combining tables, renaming). Otherwise it's fine to return the model directly at first.
- Keep the layers though: **Controller → Service → Repository → DB**. Even a small server
  benefits from that structure, and it's what interviewers/reviewers look for.
- Rule of thumb: **YAGNI** ("You Aren't Gonna Need It") — add a pattern when a concrete
  problem demands it, not because a diagram says so.

---

## One-line summary

ERD models your *tables*; the class diagram models your *code objects*; DTO/Entity/DB-Model
are the same concept wearing different hats at different **layers** of the app — and the
topic name that ties it all together is **layered application architecture**.
