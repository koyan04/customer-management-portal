--
-- PostgreSQL database dump
--

-- Dumped from database version 18.0
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: admins_audit_trigger_fn(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.admins_audit_trigger_fn() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  old_json jsonb;
  new_json jsonb;
  actor integer;
  pw_changed boolean := false;
  changed text[] := ARRAY[]::text[];
BEGIN
  actor := (CASE WHEN current_setting('app.current_admin_id', true) IS NULL THEN NULL ELSE current_setting('app.current_admin_id', true)::int END);

  IF (TG_OP = 'UPDATE') THEN
    pw_changed := (OLD.password_hash IS DISTINCT FROM NEW.password_hash);

    IF (OLD.display_name IS DISTINCT FROM NEW.display_name) THEN
      changed := array_append(changed, 'display_name');
    END IF;
    IF (OLD.username IS DISTINCT FROM NEW.username) THEN
      changed := array_append(changed, 'username');
    END IF;
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
      changed := array_append(changed, 'role');
    END IF;
    IF (OLD.avatar_url IS DISTINCT FROM NEW.avatar_url) THEN
      changed := array_append(changed, 'avatar_url');
    END IF;
    IF (OLD.avatar_data IS DISTINCT FROM NEW.avatar_data) THEN
      changed := array_append(changed, 'avatar_data');
    END IF;

    old_json := to_jsonb(OLD) - 'password_hash';
    new_json := to_jsonb(NEW) - 'password_hash';

    INSERT INTO admins_audit (admin_id, changed_by, change_type, old, new, password_changed, changed_fields, created_at)
    VALUES (
      OLD.id,
      actor,
      'UPDATE',
      old_json,
      new_json,
      pw_changed,
      changed,
      now()
    );

    NEW.updated_at := now();
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    new_json := to_jsonb(NEW) - 'password_hash';
    INSERT INTO admins_audit (admin_id, changed_by, change_type, old, new, password_changed, changed_fields, created_at)
    VALUES (
      NEW.id,
      actor,
      'INSERT',
      NULL,
      new_json,
      false,
      ARRAY[]::text[],
      now()
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.admins_audit_trigger_fn() OWNER TO CURRENT_USER;

--
-- Name: app_settings_enforce_general_updated_by(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.app_settings_enforce_general_updated_by() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  IF NEW.settings_key = 'general' THEN

    IF NEW.updated_by IS NULL THEN

      RAISE EXCEPTION USING

        MESSAGE = 'app_settings.general updates must originate from the Admin UI save flow (updated_by required)';

    END IF;

    PERFORM 1 FROM admins WHERE id = NEW.updated_by;

    IF NOT FOUND THEN

      RAISE EXCEPTION USING

        MESSAGE = format('app_settings.general updated_by % does not reference an existing admin', NEW.updated_by);

    END IF;

  END IF;

  RETURN NEW;

END;

$$;


ALTER FUNCTION public.app_settings_enforce_general_updated_by() OWNER TO CURRENT_USER;

--
-- Name: app_settings_prevent_general_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.app_settings_prevent_general_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  BEGIN

    INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data)

    VALUES (OLD.updated_by, OLD.settings_key, 'DELETE_BLOCKED', OLD.data, NULL);

  EXCEPTION WHEN others THEN

    -- best-effort audit only; ignore failures so the primary error surfaces

  END;

  RAISE EXCEPTION USING

    MESSAGE = 'Deletion of app_settings.general is blocked; use the Admin UI to modify this record instead';

END;

$$;


ALTER FUNCTION public.app_settings_prevent_general_delete() OWNER TO CURRENT_USER;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admins (
    id integer NOT NULL,
    display_name character varying(255),
    username character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    avatar_url text,
    avatar_data text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT admins_role_check CHECK (((role)::text = ANY ((ARRAY['ADMIN'::character varying, 'VIEWER'::character varying, 'SERVER_ADMIN'::character varying])::text[])))
);


ALTER TABLE public.admins OWNER TO CURRENT_USER;

--
-- Name: admins_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admins_audit (
    id bigint NOT NULL,
    admin_id integer NOT NULL,
    changed_by integer,
    change_type text NOT NULL,
    old jsonb,
    new jsonb,
    created_at timestamp with time zone DEFAULT now(),
    changed_fields text[] DEFAULT '{}'::text[],
    password_changed boolean DEFAULT false
);


ALTER TABLE public.admins_audit OWNER TO CURRENT_USER;

--
-- Name: admins_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admins_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admins_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: admins_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admins_audit_id_seq OWNED BY public.admins_audit.id;


--
-- Name: admins_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admins_id_seq OWNER TO CURRENT_USER;

--
-- Name: admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    settings_key text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.app_settings OWNER TO CURRENT_USER;

--
-- Name: control_panel_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.control_panel_audit (
    id integer NOT NULL,
    admin_id integer,
    action text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.control_panel_audit OWNER TO CURRENT_USER;

--
-- Name: control_panel_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.control_panel_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.control_panel_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: control_panel_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.control_panel_audit_id_seq OWNED BY public.control_panel_audit.id;


--
-- Name: editor_server_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.editor_server_permissions (
    id integer NOT NULL,
    editor_id integer NOT NULL,
    server_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.editor_server_permissions OWNER TO CURRENT_USER;

--
-- Name: editor_server_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.editor_server_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.editor_server_permissions_id_seq OWNER TO CURRENT_USER;

--
-- Name: editor_server_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.editor_server_permissions_id_seq OWNED BY public.editor_server_permissions.id;


--
-- Name: invalidated_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invalidated_tokens (
    id integer NOT NULL,
    jti text NOT NULL,
    admin_id integer,
    reason text,
    invalidated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.invalidated_tokens OWNER TO CURRENT_USER;

--
-- Name: invalidated_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invalidated_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invalidated_tokens_id_seq OWNER TO CURRENT_USER;

--
-- Name: invalidated_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invalidated_tokens_id_seq OWNED BY public.invalidated_tokens.id;


--
-- Name: login_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_audit (
    id bigint NOT NULL,
    admin_id integer NOT NULL,
    role text NOT NULL,
    ip text,
    user_agent text,
    geo_city text,
    geo_country text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.login_audit OWNER TO CURRENT_USER;

--
-- Name: login_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.login_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.login_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: login_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.login_audit_id_seq OWNED BY public.login_audit.id;


--
-- Name: password_reset_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_reset_audit (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    target_account_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    note text
);


ALTER TABLE public.password_reset_audit OWNER TO CURRENT_USER;

--
-- Name: password_reset_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.password_reset_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_reset_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: password_reset_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.password_reset_audit_id_seq OWNED BY public.password_reset_audit.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    token_hash text NOT NULL,
    admin_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO CURRENT_USER;

--
-- Name: server_admin_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.server_admin_permissions (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    server_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.server_admin_permissions OWNER TO CURRENT_USER;

--
-- Name: server_admin_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.server_admin_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.server_admin_permissions_id_seq OWNER TO CURRENT_USER;

--
-- Name: server_admin_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.server_admin_permissions_id_seq OWNED BY public.server_admin_permissions.id;


--
-- Name: server_keys; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.server_keys (
    id integer NOT NULL,
    server_id integer NOT NULL,
    username text,
    description text,
    original_key text,
    generated_key text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.server_keys OWNER TO CURRENT_USER;

--
-- Name: server_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.server_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.server_keys_id_seq OWNER TO CURRENT_USER;

--
-- Name: server_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.server_keys_id_seq OWNED BY public.server_keys.id;


--
-- Name: servers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.servers (
    id integer NOT NULL,
    server_name character varying(255) NOT NULL,
    owner character varying(255),
    service_type character varying(100),
    ip_address character varying(45),
    domain_name character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    display_pos integer
);


ALTER TABLE public.servers OWNER TO CURRENT_USER;

--
-- Name: servers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.servers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.servers_id_seq OWNER TO CURRENT_USER;

--
-- Name: servers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.servers_id_seq OWNED BY public.servers.id;


--
-- Name: settings_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.settings_audit (
    id integer NOT NULL,
    admin_id integer,
    settings_key text NOT NULL,
    action text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.settings_audit OWNER TO CURRENT_USER;

--
-- Name: settings_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.settings_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.settings_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: settings_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.settings_audit_id_seq OWNED BY public.settings_audit.id;


--
-- Name: telegram_chat_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telegram_chat_notifications (
    chat_id bigint NOT NULL,
    login_notification boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.telegram_chat_notifications OWNER TO CURRENT_USER;

--
-- Name: telegram_login_notify_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telegram_login_notify_audit (
    id bigint NOT NULL,
    chat_id bigint,
    admin_id integer,
    username text,
    ip text,
    user_agent text,
    status text,
    error text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now(),
    role text
);


ALTER TABLE public.telegram_login_notify_audit OWNER TO CURRENT_USER;

--
-- Name: telegram_login_notify_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.telegram_login_notify_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.telegram_login_notify_audit_id_seq OWNER TO CURRENT_USER;

--
-- Name: telegram_login_notify_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.telegram_login_notify_audit_id_seq OWNED BY public.telegram_login_notify_audit.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    account_name character varying(255) NOT NULL,
    service_type character varying(100),
    contact character varying(100),
    expire_date date,
    total_devices integer,
    data_limit_gb integer,
    server_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    remark text,
    display_pos integer
);


ALTER TABLE public.users OWNER TO CURRENT_USER;

--
-- Name: user_status_matview; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.user_status_matview AS
 SELECT u.id,
    u.server_id,
    u.account_name,
    u.service_type,
    u.contact,
    u.expire_date,
    u.total_devices,
    u.data_limit_gb,
    u.remark,
    s.server_name,
    s.ip_address,
    s.domain_name,
        CASE
            WHEN ((u.expire_date + '1 day'::interval) <= now()) THEN 'expired'::text
            WHEN (((u.expire_date + '1 day'::interval) > now()) AND ((u.expire_date + '1 day'::interval) <= (now() + '1 day'::interval))) THEN 'soon'::text
            ELSE 'active'::text
        END AS status
   FROM (public.users u
     JOIN public.servers s ON ((s.id = u.server_id)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.user_status_matview OWNER TO CURRENT_USER;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO CURRENT_USER;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: viewer_server_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.viewer_server_permissions (
    id integer NOT NULL,
    editor_id integer NOT NULL,
    server_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.viewer_server_permissions OWNER TO CURRENT_USER;

--
-- Name: viewer_server_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.viewer_server_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.viewer_server_permissions_id_seq OWNER TO CURRENT_USER;

--
-- Name: viewer_server_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.viewer_server_permissions_id_seq OWNED BY public.viewer_server_permissions.id;


--
-- Name: admins id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);


--
-- Name: admins_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins_audit ALTER COLUMN id SET DEFAULT nextval('public.admins_audit_id_seq'::regclass);


--
-- Name: control_panel_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.control_panel_audit ALTER COLUMN id SET DEFAULT nextval('public.control_panel_audit_id_seq'::regclass);


--
-- Name: editor_server_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.editor_server_permissions ALTER COLUMN id SET DEFAULT nextval('public.editor_server_permissions_id_seq'::regclass);


--
-- Name: invalidated_tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invalidated_tokens ALTER COLUMN id SET DEFAULT nextval('public.invalidated_tokens_id_seq'::regclass);


--
-- Name: login_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_audit ALTER COLUMN id SET DEFAULT nextval('public.login_audit_id_seq'::regclass);


--
-- Name: password_reset_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_audit ALTER COLUMN id SET DEFAULT nextval('public.password_reset_audit_id_seq'::regclass);


--
-- Name: server_admin_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_admin_permissions ALTER COLUMN id SET DEFAULT nextval('public.server_admin_permissions_id_seq'::regclass);


--
-- Name: server_keys id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_keys ALTER COLUMN id SET DEFAULT nextval('public.server_keys_id_seq'::regclass);


--
-- Name: servers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servers ALTER COLUMN id SET DEFAULT nextval('public.servers_id_seq'::regclass);


--
-- Name: settings_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings_audit ALTER COLUMN id SET DEFAULT nextval('public.settings_audit_id_seq'::regclass);


--
-- Name: telegram_login_notify_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_login_notify_audit ALTER COLUMN id SET DEFAULT nextval('public.telegram_login_notify_audit_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: viewer_server_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.viewer_server_permissions ALTER COLUMN id SET DEFAULT nextval('public.viewer_server_permissions_id_seq'::regclass);


--
-- Name: admins_audit admins_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins_audit
    ADD CONSTRAINT admins_audit_pkey PRIMARY KEY (id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (settings_key);


--
-- Name: control_panel_audit control_panel_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.control_panel_audit
    ADD CONSTRAINT control_panel_audit_pkey PRIMARY KEY (id);


--
-- Name: editor_server_permissions editor_server_permissions_editor_id_server_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.editor_server_permissions
    ADD CONSTRAINT editor_server_permissions_editor_id_server_id_key UNIQUE (editor_id, server_id);


--
-- Name: editor_server_permissions editor_server_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.editor_server_permissions
    ADD CONSTRAINT editor_server_permissions_pkey PRIMARY KEY (id);


--
-- Name: invalidated_tokens invalidated_tokens_jti_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invalidated_tokens
    ADD CONSTRAINT invalidated_tokens_jti_key UNIQUE (jti);


--
-- Name: invalidated_tokens invalidated_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invalidated_tokens
    ADD CONSTRAINT invalidated_tokens_pkey PRIMARY KEY (id);


--
-- Name: login_audit login_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_audit
    ADD CONSTRAINT login_audit_pkey PRIMARY KEY (id);


--
-- Name: password_reset_audit password_reset_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_audit
    ADD CONSTRAINT password_reset_audit_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: server_admin_permissions server_admin_permissions_admin_id_server_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_admin_permissions
    ADD CONSTRAINT server_admin_permissions_admin_id_server_id_key UNIQUE (admin_id, server_id);


--
-- Name: server_admin_permissions server_admin_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_admin_permissions
    ADD CONSTRAINT server_admin_permissions_pkey PRIMARY KEY (id);


--
-- Name: server_keys server_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_keys
    ADD CONSTRAINT server_keys_pkey PRIMARY KEY (id);


--
-- Name: servers servers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servers
    ADD CONSTRAINT servers_pkey PRIMARY KEY (id);


--
-- Name: settings_audit settings_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings_audit
    ADD CONSTRAINT settings_audit_pkey PRIMARY KEY (id);


--
-- Name: telegram_chat_notifications telegram_chat_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_chat_notifications
    ADD CONSTRAINT telegram_chat_notifications_pkey PRIMARY KEY (chat_id);


--
-- Name: telegram_login_notify_audit telegram_login_notify_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telegram_login_notify_audit
    ADD CONSTRAINT telegram_login_notify_audit_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: viewer_server_permissions viewer_server_permissions_editor_id_server_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.viewer_server_permissions
    ADD CONSTRAINT viewer_server_permissions_editor_id_server_id_key UNIQUE (editor_id, server_id);


--
-- Name: viewer_server_permissions viewer_server_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.viewer_server_permissions
    ADD CONSTRAINT viewer_server_permissions_pkey PRIMARY KEY (id);


--
-- Name: idx_invalidated_tokens_jti; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invalidated_tokens_jti ON public.invalidated_tokens USING btree (jti);


--
-- Name: idx_login_audit_admin_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_audit_admin_created_at ON public.login_audit USING btree (admin_id, created_at DESC);


--
-- Name: idx_login_audit_admin_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_audit_admin_id ON public.login_audit USING btree (admin_id);


--
-- Name: idx_login_audit_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_audit_created_at ON public.login_audit USING btree (created_at DESC);


--
-- Name: idx_refresh_tokens_admin_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_tokens_admin_id ON public.refresh_tokens USING btree (admin_id);


--
-- Name: idx_telegram_login_notify_audit_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_telegram_login_notify_audit_role ON public.telegram_login_notify_audit USING btree (role);


--
-- Name: server_keys_server_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX server_keys_server_id_idx ON public.server_keys USING btree (server_id);


--
-- Name: servers_display_pos_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX servers_display_pos_idx ON public.servers USING btree (display_pos);


--
-- Name: user_status_matview_expire_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_status_matview_expire_idx ON public.user_status_matview USING btree (expire_date);


--
-- Name: user_status_matview_id_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_status_matview_id_unique_idx ON public.user_status_matview USING btree (id);


--
-- Name: user_status_matview_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX user_status_matview_status_idx ON public.user_status_matview USING btree (status);


--
-- Name: users_display_pos_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_display_pos_idx ON public.users USING btree (server_id, display_pos);


--
-- Name: users_server_account_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_server_account_unique_idx ON public.users USING btree (server_id, account_name);


--
-- Name: users_server_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_server_id_idx ON public.users USING btree (server_id);


--
-- Name: admins admins_audit_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER admins_audit_trigger AFTER INSERT OR UPDATE ON public.admins FOR EACH ROW EXECUTE FUNCTION public.admins_audit_trigger_fn();


--
-- Name: app_settings trg_app_settings_enforce_general_updated_by; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_app_settings_enforce_general_updated_by BEFORE INSERT OR UPDATE ON public.app_settings FOR EACH ROW WHEN ((new.settings_key = 'general'::text)) EXECUTE FUNCTION public.app_settings_enforce_general_updated_by();


--
-- Name: app_settings trg_app_settings_prevent_general_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_app_settings_prevent_general_delete BEFORE DELETE ON public.app_settings FOR EACH ROW WHEN ((old.settings_key = 'general'::text)) EXECUTE FUNCTION public.app_settings_prevent_general_delete();


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.admins(id) ON DELETE SET NULL;


--
-- Name: editor_server_permissions editor_server_permissions_editor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.editor_server_permissions
    ADD CONSTRAINT editor_server_permissions_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: editor_server_permissions editor_server_permissions_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.editor_server_permissions
    ADD CONSTRAINT editor_server_permissions_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE;


--
-- Name: login_audit login_audit_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_audit
    ADD CONSTRAINT login_audit_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: password_reset_audit password_reset_audit_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_audit
    ADD CONSTRAINT password_reset_audit_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;


--
-- Name: password_reset_audit password_reset_audit_target_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_audit
    ADD CONSTRAINT password_reset_audit_target_account_id_fkey FOREIGN KEY (target_account_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: server_admin_permissions server_admin_permissions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_admin_permissions
    ADD CONSTRAINT server_admin_permissions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: server_admin_permissions server_admin_permissions_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_admin_permissions
    ADD CONSTRAINT server_admin_permissions_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE;


--
-- Name: server_keys server_keys_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.server_keys
    ADD CONSTRAINT server_keys_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE;


--
-- Name: settings_audit settings_audit_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.settings_audit
    ADD CONSTRAINT settings_audit_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;


--
-- Name: users users_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE;


--
-- Name: viewer_server_permissions viewer_server_permissions_editor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.viewer_server_permissions
    ADD CONSTRAINT viewer_server_permissions_editor_id_fkey FOREIGN KEY (editor_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: viewer_server_permissions viewer_server_permissions_server_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.viewer_server_permissions
    ADD CONSTRAINT viewer_server_permissions_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

