package practice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
	"github.com/samandar-hodiev/engora/apps/api/internal/analytics"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/storage"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/cefr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// The live speaking coach: a conversation instead of a report.
//
// Ordinary speaking practice records an answer, judges it, and shows the verdict afterwards.
// That is useful, and it is also the wrong shape for the thing people actually want to get
// better at, which is speaking to someone. Here each turn is transcribed, judged and
// answered while the learner is still in the conversation, so the correction lands while
// they can still use it in the next sentence.
//
// It is a WebSocket because the turns belong to one session: the coach's next question
// depends on the previous answer, the budget is charged per turn, and the whole exchange is
// saved as a single practice session. A sequence of unrelated HTTP posts could carry the
// audio but not the conversation.
//
// What it is not: streaming recognition. The learner's client records a turn and sends it;
// we do not pretend to transcribe syllables as they are spoken, because we do not have a
// streaming recogniser and faking one would produce worse feedback, not faster feedback.

const (
	entitlementLiveCoach = "speaking.live_coach"

	// LiveSpeakingRoute is the upgrade endpoint.
	LiveSpeakingRoute = "/api/v1/speaking/live"

	// A conversation, not a lecture. Past this the session is long enough that the learner
	// is better served by a summary and a fresh start.
	maxLiveTurns = 8

	// Idle limits. A browser tab left open must not hold a connection, a database row and a
	// budget reservation for the rest of the day.
	liveIdleTimeout    = 3 * time.Minute
	liveSessionTimeout = 30 * time.Minute
	liveWriteTimeout   = 15 * time.Second
	// Pings keep the connection alive through proxies and load balancers, most of which
	// close a WebSocket that has been silent for 60–100 seconds — which is exactly what a
	// connection looks like while the learner reads their feedback.
	livePingInterval = 25 * time.Second

	// A turn shorter than this is a false start or a cough. The learner is told, and is not
	// charged for it.
	minTurnSeconds = 3
)

// Conversationalist generates the coach's spoken side of the conversation. Optional: with
// no generator the coach still gives feedback, it just asks from a fixed set of follow-ups
// instead of reacting to what was said.
type Conversationalist interface {
	AnalyzeText(ctx context.Context, meta ai.CallMeta, req ai.AnalysisRequest) (*ai.AnalysisResponse, error)
}

// ---- wire protocol -------------------------------------------------------------------------

type liveClientMessage struct {
	Type       string     `json:"type"`
	TaskID     *uuid.UUID `json:"task_id,omitempty"`
	DurationMs int        `json:"duration_ms,omitempty"`
	MimeType   string     `json:"mime_type,omitempty"`

	// On start: how the learner wants to practise. All optional — an old client that sends
	// none of them gets the conversation it always got.
	Mode         string `json:"mode,omitempty"`          // free | part1 | part2 | part3
	Topic        string `json:"topic,omitempty"`         // a topic title, when there is no task id
	FeedbackLang string `json:"feedback_lang,omitempty"` // en | uz
}

type liveTurnFeedback struct {
	Turn           int               `json:"turn"`
	Transcript     string            `json:"transcript"`
	WordsPerMinute float64           `json:"words_per_minute"`
	Score          float64           `json:"score"`
	Feedback       *SpeakingFeedback `json:"feedback,omitempty"`
	// Say is what the coach says about the answer — a correction or specific praise, in the
	// learner's feedback language — before asking Reply, the next question, in English.
	Say   string `json:"say,omitempty"`
	Reply string `json:"reply"`
}

type liveServerMessage struct {
	Type string `json:"type"`

	SessionID *uuid.UUID `json:"session_id,omitempty"`
	Prompt    string     `json:"prompt,omitempty"`
	Level     string     `json:"level,omitempty"`
	MaxTurns  int        `json:"max_turns,omitempty"`

	Turn *liveTurnFeedback `json:"turn,omitempty"`

	Turns        int      `json:"turns,omitempty"`
	OverallScore *float64 `json:"overall_score,omitempty"`
	CEFREstimate string   `json:"cefr_estimate,omitempty"`
	DurationMs   int      `json:"duration_ms,omitempty"`

	Code    apperr.Code `json:"code,omitempty"`
	Message string      `json:"message,omitempty"`
}

// ---- session -------------------------------------------------------------------------------

type liveSession struct {
	m      *Module
	conn   *websocket.Conn
	userID uuid.UUID

	// wmu serialises writes: the turn handler and the pinger both write, and a WebSocket
	// allows one writer at a time.
	wmu sync.Mutex
	// inTurn is set while a turn is being judged, so a draining hub lets it finish.
	inTurn atomic.Bool
	done   chan struct{}

	id       uuid.UUID
	prompt   string
	level    cefr.Level
	platform string
	mode     string
	topic    string
	lang     string

	turn       int
	audio      bytes.Buffer
	transcript []string
	scores     []float64
	durationMs int
	started    time.Time
	// lastTranscript is what speaking_sessions.transcript_id points at. transcripts rows
	// belong to one audio file, and a conversation has several, so the session points at
	// the most recent turn and the whole exchange is read from speaking_turns.
	lastTranscript uuid.UUID
}

func (m *Module) liveSpeaking(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()

	// Everything that can be refused is refused before the upgrade, while a plain HTTP
	// status still means something to the client.
	if m.speaker == nil || m.store == nil {
		httpx.Fail(c, apperr.NotImplemented("The live speaking coach"))
		return
	}
	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementLiveCoach); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	// Room for one more conversation, and only one per learner. A full instance says so
	// with a Retry-After the client honours, rather than taking the learner on and giving
	// everyone a slower coach.
	ticket, err := m.live.admit(ctx, p.UserID)
	if err != nil {
		if apperr.From(err).Code == apperr.CodeUnavailable {
			c.Header("Retry-After", "30")
		}
		httpx.Fail(c, err)
		return
	}
	defer ticket.release()

	// When a browser offers subprotocols the server has to pick one, or the browser fails
	// the connection. The learner's client offers ["bearer", "<token>"] to carry the access
	// token in a header instead of the URL, so "bearer" is what we select back.
	var handshake http.Header
	if strings.HasPrefix(strings.TrimSpace(c.GetHeader("Sec-WebSocket-Protocol")), "bearer") {
		handshake = http.Header{"Sec-WebSocket-Protocol": []string{"bearer"}}
	}
	conn, err := m.upgrader().Upgrade(c.Writer, c.Request, handshake)
	if err != nil {
		return // Upgrade has already written a response.
	}
	defer func() { _ = conn.Close() }()

	s := &liveSession{
		m: m, conn: conn, userID: p.UserID, platform: httpx.ClientPlatform(c), started: time.Now(),
		done: make(chan struct{}),
	}
	m.live.register(s)
	defer m.live.unregister(s)
	go s.ping()
	defer close(s.done)
	s.run(context.WithoutCancel(ctx))
}

// ping keeps the connection open through proxies while nobody is talking.
func (s *liveSession) ping() {
	tick := time.NewTicker(livePingInterval)
	defer tick.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-tick.C:
			s.wmu.Lock()
			err := s.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(liveWriteTimeout))
			s.wmu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

// wake is how a draining hub reaches a conversation blocked waiting for the learner: the
// read is cut short, and the loop sees the drain. A conversation mid-turn is left alone
// and checks for the drain when the turn is done.
func (s *liveSession) wake() {
	if !s.inTurn.Load() {
		_ = s.conn.SetReadDeadline(time.Now())
	}
}

// closeNow ends the connection outright, for a drain that ran out of time.
func (s *liveSession) closeNow() { _ = s.conn.Close() }

// reconnect saves what was said and tells the client to open a new conversation — on
// another instance, since this one is going away.
func (s *liveSession) reconnect(ctx context.Context) {
	s.abandon(ctx)
	s.send(liveServerMessage{Type: "reconnect", Message: "The coach is restarting. Reconnecting…"})
	s.wmu.Lock()
	_ = s.conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseServiceRestart, "restarting"),
		time.Now().Add(liveWriteTimeout))
	s.wmu.Unlock()
}

// liveStatus is the pre-flight for a live conversation: the same refusals the upgrade would
// make — no plan, no room, another tab — as an ordinary JSON answer the client can read and
// explain. A refused WebSocket gives the browser no status code at all.
func (m *Module) liveStatus(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	ctx := c.Request.Context()
	if m.speaker == nil || m.store == nil {
		httpx.Fail(c, apperr.NotImplemented("The live speaking coach"))
		return
	}
	if m.plans != nil {
		if err := m.plans.RequireFeature(ctx, p.UserID, entitlementLiveCoach); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	if err := m.live.check(ctx, p.UserID); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, gin.H{"available": true, "max_turns": maxLiveTurns})
}

// upgrader rejects cross-origin upgrades. WebSocket connections are not covered by CORS, so
// without this check any page on the internet could open a session as a logged-in learner
// and spend their budget.
func (m *Module) upgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  4 << 10,
		WriteBufferSize: 4 << 10,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // not a browser
			}
			u, err := url.Parse(origin)
			if err != nil {
				return false
			}
			if strings.EqualFold(u.Host, r.Host) {
				return true
			}
			for _, allowed := range m.origins {
				if strings.EqualFold(allowed, origin) {
					return true
				}
			}
			return false
		},
	}
}

func (s *liveSession) run(ctx context.Context) {
	deadline := s.started.Add(liveSessionTimeout)
	s.conn.SetReadLimit(s.m.maxUpload + 1<<20)

	for {
		if time.Now().After(deadline) {
			s.fail(apperr.Conflict("This session has been open too long. Start a new one."))
			return
		}
		if s.m.live.Draining() {
			s.reconnect(ctx)
			return
		}
		_ = s.conn.SetReadDeadline(time.Now().Add(liveIdleTimeout))
		kind, data, err := s.conn.ReadMessage()
		if err != nil {
			if s.m.live.Draining() {
				s.reconnect(ctx)
				return
			}
			s.abandon(ctx)
			return
		}

		if kind == websocket.BinaryMessage {
			// Audio for the turn in progress. The read limit caps a single frame; this caps
			// the turn, so a client cannot stream forever in small frames.
			if int64(s.audio.Len()+len(data)) > s.m.maxUpload {
				s.fail(apperr.New(apperr.CodePayloadTooLarge, "That turn is too long. Speak for up to a minute at a time."))
				return
			}
			s.audio.Write(data)
			continue
		}

		var msg liveClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			s.fail(apperr.BadRequest("Unreadable message"))
			return
		}
		switch msg.Type {
		case "start":
			if s.id != uuid.Nil {
				s.fail(apperr.Conflict("This session has already started"))
				return
			}
			s.mode, s.topic, s.lang = liveMode(msg.Mode), cleanTopic(msg.Topic), feedbackLang(msg.FeedbackLang)
			if err := s.start(ctx, msg.TaskID); err != nil {
				s.fail(err)
				return
			}
		case "turn_end":
			if s.id == uuid.Nil {
				s.fail(apperr.Conflict("Send start before speaking"))
				return
			}
			s.inTurn.Store(true)
			started := time.Now()
			err := s.handleTurn(ctx, msg)
			s.inTurn.Store(false)
			s.m.live.observeTurn(time.Since(started), err != nil)
			if err != nil {
				// A bad turn is not a bad session: the learner is told what went wrong and
				// can speak again. Only the protocol errors above end the conversation.
				s.send(liveServerMessage{Type: "error", Code: apperr.From(err).Code, Message: apperr.From(err).Message})
				s.audio.Reset()
				continue
			}
			if s.turn >= maxLiveTurns {
				s.finish(ctx)
				return
			}
		case "finish":
			s.finish(ctx)
			return
		default:
			s.fail(apperr.BadRequest("Unknown message type"))
			return
		}
	}
}

func (s *liveSession) start(ctx context.Context, taskID *uuid.UUID) error {
	prompt, level := s.m.speakingPrompt(ctx, s.userID, taskID)
	s.prompt = openingLine(s.mode, s.topic, prompt, taskID != nil)
	parsed, err := cefr.Parse(level)
	if err != nil {
		parsed = cefr.MustParse("B1")
	}
	s.level = parsed

	if err := s.m.pool.QueryRow(ctx, `
		INSERT INTO speaking_sessions (user_id, content_item_id, mode, status, client_platform)
		VALUES ($1, $2, 'live', 'in_progress', $3) RETURNING id`,
		s.userID, taskID, s.platform).Scan(&s.id); err != nil {
		return err
	}
	s.send(liveServerMessage{
		Type: "ready", SessionID: &s.id, Prompt: s.prompt, Level: s.level.String(), MaxTurns: maxLiveTurns,
	})
	return nil
}

// handleTurn runs the same three stages as one-shot practice — store, transcribe, judge —
// and then adds the thing that makes it a conversation: a reply.
func (s *liveSession) handleTurn(ctx context.Context, msg liveClientMessage) error {
	// A turn has a deadline as a whole. Each AI call has its own too (in the gateway), but
	// three slow calls in a row must still not keep a learner waiting past this.
	ctx, cancel := context.WithTimeout(ctx, s.m.turnTimeout)
	defer cancel()

	data := append([]byte(nil), s.audio.Bytes()...)
	s.audio.Reset()
	if len(data) == 0 {
		return apperr.BadRequest("No audio was received for that turn")
	}

	policy := storage.AudioPolicy(s.m.maxUpload)
	allowed, err := policy.Validate(msg.MimeType, int64(len(data)), data[:min(len(data), 512)])
	if err != nil {
		return err
	}

	key := storage.NewKey("audio", s.userID, allowed.Extension, time.Now())
	if err := s.m.store.Put(ctx, key, bytes.NewReader(data), int64(len(data)), allowed.Canonical); err != nil {
		return apperr.New(apperr.CodeUnavailable, "We couldn't save that turn. Please try again.")
	}
	sum := sha256.Sum256(data)

	var audioID uuid.UUID
	if err := s.m.pool.QueryRow(ctx, `
		INSERT INTO audio_files (user_id, storage_provider, storage_key, mime_type, size_bytes, duration_ms,
		                         checksum_sha256, purpose, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'speaking_practice', 'uploaded') RETURNING id`,
		s.userID, s.m.store.Provider(), key, allowed.Canonical, len(data), msg.DurationMs,
		hex.EncodeToString(sum[:])).Scan(&audioID); err != nil {
		return err
	}

	// Charged per turn, like every other AI evaluation, and given back the moment a stage
	// fails to produce what was paid for.
	if s.m.usage != nil {
		if err := s.m.usage.ConsumeUsage(ctx, s.userID, entitlementSpeakingChecks, 1); err != nil {
			return err
		}
	}
	refund := func() {
		if s.m.usage != nil {
			// Detached: a turn that timed out must still give back what it was charged.
			_ = s.m.usage.ReleaseUsage(context.WithoutCancel(ctx), s.userID, entitlementSpeakingChecks, 1)
		}
	}

	transcription, err := s.m.speaker.Transcribe(ctx, s.userID, bytes.NewReader(data),
		fmt.Sprintf("turn-%d%s", s.turn+1, allowed.Extension), allowed.Canonical)
	if err != nil || transcription == nil {
		refund()
		return apperr.New(apperr.CodeUnavailable, "We couldn't hear that. Try again a little closer to the microphone.")
	}

	seconds := transcription.DurationSeconds
	if seconds <= 0 && msg.DurationMs > 0 {
		seconds = float64(msg.DurationMs) / 1000
	}
	if seconds < minTurnSeconds || len(transcription.Text) < 10 {
		refund()
		return apperr.BadRequest("That was too short to give feedback on. Try a full sentence or two.")
	}

	var transcriptID uuid.UUID
	if err := s.m.pool.QueryRow(ctx, `
		INSERT INTO transcripts (user_id, audio_file_id, text, provider, model)
		VALUES ($1, $2, $3, '', $4) RETURNING id`,
		s.userID, audioID, transcription.Text, transcription.Model).Scan(&transcriptID); err != nil {
		return err
	}

	wpm := 0.0
	if seconds > 0 {
		wpm = float64(countWords(transcription.Text)) / seconds * 60
	}

	// The next question depends only on what was said, not on how it was judged, so it is
	// asked while the judging runs. The learner waits for the slower of the two, not both.
	replyCh := make(chan coachReply, 1)
	go func() {
		replyCh <- s.m.coachTurn(ctx, s.userID, s.level, s.mode, s.topic, s.lang, s.currentPrompt(), transcription.Text)
	}()

	assessment, meta, err := s.m.speaker.EvaluateSpeaking(ctx, ai.SpeakingAssessmentInput{
		UserID: s.userID, TaskPrompt: s.currentPrompt(), TargetLevel: s.level,
		Transcript: transcription.Text, SpeechSeconds: seconds, WordsPerMinute: wpm,
		ExplanationLanguage: s.lang,
	})
	if err != nil || assessment == nil {
		refund()
		return apperr.New(apperr.CodeUnavailable, "Feedback is temporarily unavailable. Keep going — the turn was saved.")
	}

	score := (assessment.Fluency + assessment.Grammar + assessment.Vocabulary + assessment.Relevance) / 4
	analysisID, err := s.m.recordTurnAnalysis(ctx, s.userID, s.id, assessment, meta, score)
	if err != nil {
		return err
	}

	s.turn++
	s.lastTranscript = transcriptID
	s.transcript = append(s.transcript, transcription.Text)
	s.scores = append(s.scores, score)
	s.durationMs += msg.DurationMs

	coach := <-replyCh
	reply := coach.Ask

	if _, err := s.m.pool.Exec(ctx, `
		INSERT INTO speaking_turns (session_id, turn_number, audio_file_id, transcript_id, analysis_id,
		                            prompt, transcript, coach_reply, score, duration_ms, words_per_minute)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		s.id, s.turn, audioID, transcriptID, analysisID, s.currentPrompt(), transcription.Text, reply,
		score, msg.DurationMs, wpm); err != nil {
		return err
	}

	feedback := &SpeakingFeedback{
		Fluency: assessment.Fluency, Grammar: assessment.Grammar, Vocabulary: assessment.Vocabulary,
		Relevance: assessment.Relevance, CEFREstimate: assessment.CEFREstimate,
		Confidence: assessment.Confidence, Mistakes: assessment.Mistakes,
	}
	s.send(liveServerMessage{Type: "turn", Turn: &liveTurnFeedback{
		Turn: s.turn, Transcript: transcription.Text, WordsPerMinute: round2(wpm),
		Score: round2(score), Feedback: feedback, Say: coach.Say, Reply: reply,
	}})
	s.prompt = reply
	return nil
}

// currentPrompt is what the learner was answering: the coach's last question, or the
// opening task for the first turn.
func (s *liveSession) currentPrompt() string { return s.prompt }

// finish closes the conversation and writes the session the way one-shot practice writes
// one, so it counts as practice everywhere else in the product.
func (s *liveSession) finish(ctx context.Context) {
	if s.id == uuid.Nil {
		return
	}
	if s.turn == 0 {
		// Nothing was said. A zero-turn session in the history would be noise.
		_, _ = s.m.pool.Exec(ctx, `DELETE FROM speaking_sessions WHERE id = $1 AND user_id = $2`, s.id, s.userID)
		s.send(liveServerMessage{Type: "summary", SessionID: &s.id, Turns: 0})
		return
	}

	var overall float64
	for _, sc := range s.scores {
		overall += sc
	}
	overall = round2(overall / float64(len(s.scores)))

	if _, err := s.m.pool.Exec(ctx, `
		UPDATE speaking_sessions
		SET status = 'completed', transcript_id = $2, overall_score = $3, duration_ms = $4,
		    submitted_at = coalesce(submitted_at, now()), completed_at = now()
		WHERE id = $1`, s.id, s.lastTranscript, overall, s.durationMs); err != nil {
		s.fail(err)
		return
	}
	if _, err := s.m.pool.Exec(ctx, `
		INSERT INTO skill_progress (user_id, skill_id, score, sessions_count, last_practiced_at)
		SELECT $1, sk.id, $2, 1, now() FROM skills sk WHERE sk.code = 'speaking'
		ON CONFLICT (user_id, skill_id) DO UPDATE SET
			score = round((skill_progress.score * 0.7 + EXCLUDED.score * 0.3)::numeric, 2),
			sessions_count = skill_progress.sessions_count + 1,
			last_practiced_at = now()`, s.userID, overall); err != nil {
		s.fail(err)
		return
	}

	if s.m.track != nil {
		s.m.track.Track(ctx, analytics.Server("live_speaking_completed", s.userID, map[string]any{
			"session_id": s.id.String(), "turns": s.turn, "score": overall,
		}))
	}
	s.send(liveServerMessage{
		Type: "summary", SessionID: &s.id, Turns: s.turn, OverallScore: &overall,
		CEFREstimate: s.level.String(), DurationMs: s.durationMs,
	})
}

// abandon is what happens when the connection drops: a closed tab, a lost network, a
// learner who simply walked away. The turns already spoken are kept and the session is
// completed as if they had said so, because they did the work and the score is real. The
// summary written here goes nowhere — the socket is already gone — but the row is what
// matters.
func (s *liveSession) abandon(ctx context.Context) {
	if s.id == uuid.Nil {
		return
	}
	if s.turn == 0 {
		_, _ = s.m.pool.Exec(ctx, `DELETE FROM speaking_sessions WHERE id = $1 AND user_id = $2`, s.id, s.userID)
		return
	}
	s.finish(ctx)
}

func (s *liveSession) send(msg liveServerMessage) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(liveWriteTimeout))
	_ = s.conn.WriteJSON(msg)
}

func (s *liveSession) fail(err error) {
	e := apperr.From(err)
	s.send(liveServerMessage{Type: "error", Code: e.Code, Message: e.Message})
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.ClosePolicyViolation, string(e.Code)),
		time.Now().Add(liveWriteTimeout))
}

// recordTurnAnalysis stores one turn's judgement with its versions, exactly as the one-shot
// pipeline does, so live turns appear in AI quality monitoring alongside everything else.
func (m *Module) recordTurnAnalysis(
	ctx context.Context, userID, sessionID uuid.UUID,
	assessment *ai.SpeakingAssessment, meta ai.EvaluationMeta, score float64,
) (uuid.UUID, error) {
	payload, err := json.Marshal(assessment)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = m.pool.QueryRow(ctx, `
		INSERT INTO ai_analyses (user_id, subject_type, subject_id, analysis_type, status, result,
		                         overall_score, schema_version, model_version, prompt_version,
		                         rubric_version, analysis_version, provider, completed_at)
		VALUES ($1, 'speaking_session', $2, 'speaking_evaluation', 'completed', $3, $4, $5, $6, $7, $8, $9, $10, now())
		RETURNING id`,
		userID, sessionID, payload, score, meta.SchemaVersion, meta.ModelVersion,
		meta.PromptVersion, meta.RubricVersion, meta.AnalysisVersion, meta.Provider).Scan(&id)
	return id, err
}

// fallbackFollowUps keep the conversation moving when no generator is configured. They are
// deliberately open questions: a yes/no question ends a speaking turn in one word.
var fallbackFollowUps = []string{
	"Why do you think that is?",
	"Can you give me an example from your own life?",
	"How would you explain that to someone who disagrees?",
	"What would you change about it, and why?",
	"How was it different five years ago?",
	"What is the hardest part of that for you?",
	"What would you tell someone doing it for the first time?",
	"How do you think it will change in the future?",
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// ---- reading a conversation back -----------------------------------------------------------

type SpeakingTurn struct {
	Turn           int       `json:"turn"`
	Prompt         string    `json:"prompt"`
	Transcript     string    `json:"transcript"`
	CoachReply     string    `json:"coach_reply"`
	Score          *float64  `json:"score"`
	DurationMs     int       `json:"duration_ms"`
	WordsPerMinute *float64  `json:"words_per_minute"`
	CreatedAt      time.Time `json:"created_at"`
}

// speakingTurns replays one live conversation. A learner reviewing a session needs the
// questions as much as their answers: an answer without its question is a sentence with no
// subject.
func (m *Module) speakingTurns(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid session id"))
		return
	}
	turns, err := m.turnsOf(c.Request.Context(), id, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, turns)
}

// turnsOf reads a session's turns, scoped to its owner so a session id is not a way to read
// somebody else's conversation.
func (m *Module) turnsOf(ctx context.Context, sessionID, userID uuid.UUID) ([]SpeakingTurn, error) {
	rows, err := m.pool.Query(ctx, `
		SELECT t.turn_number, t.prompt, t.transcript, t.coach_reply, t.score::float8,
		       t.duration_ms, t.words_per_minute::float8, t.created_at
		FROM speaking_turns t
		JOIN speaking_sessions s ON s.id = t.session_id
		WHERE t.session_id = $1 AND s.user_id = $2
		ORDER BY t.turn_number`, sessionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SpeakingTurn{}
	for rows.Next() {
		var t SpeakingTurn
		if err := rows.Scan(&t.Turn, &t.Prompt, &t.Transcript, &t.CoachReply, &t.Score,
			&t.DurationMs, &t.WordsPerMinute, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
