// ChatStore.cs — Persistance du chat de l'arène dans SQL Server.
// --------------------------------------------------------------------------
// Deux tables (créées à la demande, idempotent, comme StrategyStore) :
//   dbo.ChatUsers    — un pseudo unique par joueur (+ jeton secret d'appartenance)
//   dbo.ChatMessages — historique des messages (IDENTITY croissante = ordre + curseur)
//
// Pseudo unique : la clé primaire sur UserName (collation par défaut = insensible
// à la casse) garantit l'unicité ; « Ada » == « ada ».  Le joueur choisit son
// pseudo UNE seule fois : à l'enregistrement il reçoit un jeton, mémorisé côté
// client (localStorage), qui l'autorise ensuite à publier sous ce pseudo.
namespace PdArena;

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Data.SqlClient;

/// <summary>Corps de la requête d'enregistrement de pseudo.</summary>
public sealed class ChatRegisterDto
{
    public string UserName { get; set; } = "";
}

/// <summary>Un message du chat renvoyé au client.</summary>
public sealed class ChatMessage
{
    public long Id { get; set; }
    public string UserName { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTime At { get; set; }
}

/// <summary>Résultat d'un enregistrement de pseudo.</summary>
public sealed class ChatRegisterResult
{
    public bool Ok { get; set; }
    public string? Token { get; set; }
    public string? Error { get; set; }
}

public sealed class ChatStore
{
    private readonly string _connStr;
    private int _schemaReady;

    public const int MaxNameLen = 24;
    public const int MinNameLen = 2;
    public const int MaxTextLen = 500;

    // Pseudo : lettres (accents inclus), chiffres, espace, tiret, underscore, point.
    private static readonly Regex NameRx =
        new(@"^[\p{L}\p{N} ._-]{2,24}$", RegexOptions.Compiled);

    public ChatStore(string connectionString)
    {
        _connStr = connectionString
            ?? throw new ArgumentNullException(nameof(connectionString));
    }

    private SqlConnection Open()
    {
        var c = new SqlConnection(_connStr);
        c.Open();
        EnsureSchema(c);
        return c;
    }

    private void EnsureSchema(SqlConnection c)
    {
        if (Interlocked.CompareExchange(ref _schemaReady, 1, 0) != 0) return;
        try
        {
            const string ddl = @"
IF OBJECT_ID('dbo.ChatUsers','U') IS NULL
CREATE TABLE dbo.ChatUsers (
    UserName   NVARCHAR(24)  NOT NULL CONSTRAINT PK_ChatUsers PRIMARY KEY,
    Token      NVARCHAR(64)  NOT NULL,
    CreatedAt  DATETIME2     NOT NULL
);
IF OBJECT_ID('dbo.ChatMessages','U') IS NULL
CREATE TABLE dbo.ChatMessages (
    Id         BIGINT        IDENTITY(1,1) CONSTRAINT PK_ChatMessages PRIMARY KEY,
    UserName   NVARCHAR(24)  NOT NULL,
    Text       NVARCHAR(500) NOT NULL,
    CreatedAt  DATETIME2     NOT NULL
);";
            using var cmd = new SqlCommand(ddl, c);
            cmd.ExecuteNonQuery();
        }
        catch
        {
            _schemaReady = 0; // nouvel essai à la prochaine requête
            throw;
        }
    }

    /// <summary>Normalise + valide un pseudo.  Retourne null si invalide.</summary>
    public static string? Normalize(string? raw)
    {
        var name = (raw ?? "").Trim();
        // Réduit les espaces internes multiples à un seul.
        name = Regex.Replace(name, @"\s+", " ");
        if (name.Length < MinNameLen || name.Length > MaxNameLen) return null;
        return NameRx.IsMatch(name) ? name : null;
    }

    /// <summary>Enregistre un pseudo unique et renvoie son jeton d'appartenance.
    /// Erreur si le pseudo est déjà pris (contrainte de clé primaire).</summary>
    public ChatRegisterResult Register(string? rawName)
    {
        var name = Normalize(rawName);
        if (name is null)
            return new ChatRegisterResult { Ok = false, Error = "Pseudo invalide (2 à 24 caractères : lettres, chiffres, espace, . _ -)." };

        var token = Guid.NewGuid().ToString("N");
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(
                "INSERT INTO dbo.ChatUsers (UserName, Token, CreatedAt) VALUES (@n, @t, @at)", c);
            cmd.Parameters.AddWithValue("@n", name);
            cmd.Parameters.AddWithValue("@t", token);
            cmd.Parameters.AddWithValue("@at", DateTime.UtcNow);
            cmd.ExecuteNonQuery();
            return new ChatRegisterResult { Ok = true, Token = token };
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            // Violation de clé primaire / index unique → pseudo déjà pris.
            return new ChatRegisterResult { Ok = false, Error = "Ce pseudo est déjà pris. Choisissez-en un autre." };
        }
        catch (Exception ex)
        {
            LogDbError(nameof(Register), ex);
            return new ChatRegisterResult { Ok = false, Error = "Chat indisponible (base de données injoignable)." };
        }
    }

    /// <summary>Vérifie qu'un couple pseudo/jeton correspond bien à un enregistrement.</summary>
    public bool Validate(string? userName, string? token)
    {
        var name = Normalize(userName);
        if (name is null || string.IsNullOrEmpty(token)) return false;
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(
                "SELECT 1 FROM dbo.ChatUsers WHERE UserName = @n AND Token = @t", c);
            cmd.Parameters.AddWithValue("@n", name);
            cmd.Parameters.AddWithValue("@t", token);
            return cmd.ExecuteScalar() is not null;
        }
        catch (Exception ex) { LogDbError(nameof(Validate), ex); return false; }
    }

    /// <summary>Enregistre un message (pseudo déjà validé) et le renvoie horodaté.</summary>
    public ChatMessage? Add(string userName, string? rawText)
    {
        var name = Normalize(userName);
        var text = (rawText ?? "").Trim();
        if (name is null || text.Length == 0) return null;
        if (text.Length > MaxTextLen) text = text[..MaxTextLen];

        var at = DateTime.UtcNow;
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(
                "INSERT INTO dbo.ChatMessages (UserName, Text, CreatedAt) " +
                "OUTPUT INSERTED.Id VALUES (@n, @x, @at)", c);
            cmd.Parameters.AddWithValue("@n", name);
            cmd.Parameters.AddWithValue("@x", text);
            cmd.Parameters.AddWithValue("@at", at);
            var id = Convert.ToInt64(cmd.ExecuteScalar());
            return new ChatMessage { Id = id, UserName = name, Text = text, At = at };
        }
        catch (Exception ex) { LogDbError(nameof(Add), ex); return null; }
    }

    /// <summary>Les <paramref name="limit"/> derniers messages, du plus ancien au plus récent.</summary>
    public List<ChatMessage> Recent(int limit = 80)
    {
        limit = Math.Clamp(limit, 1, 200);
        var list = new List<ChatMessage>();
        try
        {
            using var c = Open();
            using var cmd = new SqlCommand(
                "SELECT Id, UserName, Text, CreatedAt FROM dbo.ChatMessages " +
                "ORDER BY Id DESC OFFSET 0 ROWS FETCH NEXT @lim ROWS ONLY", c);
            cmd.Parameters.AddWithValue("@lim", limit);
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new ChatMessage
                {
                    Id = r.GetInt64(0),
                    UserName = r.GetString(1),
                    Text = r.GetString(2),
                    At = r.GetDateTime(3),
                });
        }
        catch (Exception ex) { LogDbError(nameof(Recent), ex); }
        list.Reverse(); // ordre chronologique croissant pour l'affichage
        return list;
    }

    private static void LogDbError(string op, Exception ex) =>
        Console.Error.WriteLine($"[ChatStore.{op}] erreur SQL : {ex.Message}");
}
