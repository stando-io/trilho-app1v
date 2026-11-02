--
-- PostgreSQL database dump
--

\restrict nCjA0g2VtjvfH1b5xiuNhdIc5JZN1YK6fjTok7i06SYdCrUL0DEY4n9tIw2hTAM

-- Dumped from database version 18.6 (4e5fd08)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    created_by uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    key_suffix text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    ip text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    profile_id uuid,
    project_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role_id uuid
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    project_id uuid,
    card_id uuid,
    screen text,
    link text,
    dedupe_key text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    screens jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: project_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_team (
    project_id uuid NOT NULL,
    role text NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    db_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contract_number text,
    client_name text,
    start_date date,
    due_date date,
    status text,
    manager_id uuid,
    description text DEFAULT ''::text NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid text NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp with time zone NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    security_password_hash text,
    security_password_hint text,
    shortcuts jsonb,
    view_preferences jsonb,
    security_gate_base boolean DEFAULT true NOT NULL,
    security_gate_users boolean DEFAULT true NOT NULL,
    security_gate_settings boolean DEFAULT true NOT NULL,
    security_gate_integrations boolean DEFAULT true NOT NULL,
    security_gate_all boolean DEFAULT false NOT NULL,
    title_max_chars integer DEFAULT 200 NOT NULL,
    description_max_chars integer DEFAULT 4000 NOT NULL,
    notification_prefs jsonb DEFAULT '{"card_moved": true, "card_comment": true, "card_created": true, "card_mention": true, "card_assigned": true, "card_deadline": true, "card_learning_index": true, "permissions_updated": true, "project_member_added": true, "scope_password_changed": true}'::jsonb NOT NULL,
    security_gate_home boolean DEFAULT true NOT NULL,
    security_gate_dashboard boolean DEFAULT true NOT NULL,
    security_gate_board boolean DEFAULT true NOT NULL,
    CONSTRAINT system_settings_description_max_chars_check CHECK (((description_max_chars >= 100) AND (description_max_chars <= 50000))),
    CONSTRAINT system_settings_id_check CHECK ((id = 1)),
    CONSTRAINT system_settings_title_max_chars_check CHECK (((title_max_chars >= 10) AND (title_max_chars <= 1000)))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text,
    profile_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role_id uuid,
    last_login_at timestamp with time zone,
    avatar_color text,
    avatar_text_color text
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    system text DEFAULT 'generico'::text NOT NULL,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT webhooks_system_check CHECK ((system = ANY (ARRAY['discord'::text, 'slack'::text, 'n8n'::text, 'crm'::text, 'generico'::text])))
);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_name_key UNIQUE (name);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, user_id);


--
-- Name: project_team project_team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team
    ADD CONSTRAINT project_team_pkey PRIMARY KEY (project_id, role, user_id);


--
-- Name: projects projects_db_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_db_name_key UNIQUE (db_name);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: api_keys_key_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash);


--
-- Name: idx_api_keys_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_created_by ON public.api_keys USING btree (created_by);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_project ON public.audit_logs USING btree (((meta ->> 'project_id'::text)));


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token_hash);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_password_resets_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_token ON public.password_resets USING btree (token_hash);


--
-- Name: idx_project_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_user ON public.project_members USING btree (user_id);


--
-- Name: idx_project_team_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_team_user ON public.project_team USING btree (user_id);


--
-- Name: idx_sessions_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_expire ON public.sessions USING btree (expire);


--
-- Name: idx_users_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_profile ON public.users USING btree (profile_id);


--
-- Name: idx_users_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_id ON public.users USING btree (role_id);


--
-- Name: idx_webhooks_events_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_events_active ON public.webhooks USING gin (events) WHERE (active = true);


--
-- Name: api_keys api_keys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_team project_team_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team
    ADD CONSTRAINT project_team_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_team project_team_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_team
    ADD CONSTRAINT project_team_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: roles roles_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: users users_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: webhooks webhooks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict nCjA0g2VtjvfH1b5xiuNhdIc5JZN1YK6fjTok7i06SYdCrUL0DEY4n9tIw2hTAM

