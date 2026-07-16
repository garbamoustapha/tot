// ChatHub.cs — Hub SignalR du chat de l'arène (canal temps réel, indépendant du
// tournoi).  Disponible sur toutes les pages du frontend via /chatHub.
// --------------------------------------------------------------------------
// Méthodes client (reçues par le navigateur) :
//   ReceiveHistory (ChatMessage[])   — historique récent, à la connexion
//   ReceiveChat    (ChatMessage)     — nouveau message diffusé à tous
//   ChatError      (string)          — erreur d'envoi (pseudo/jeton invalide…)
namespace PdArena;

using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

public class ChatHub : Hub
{
    public const string Group = "chat";
    private readonly ChatStore _store;

    public ChatHub(ChatStore store) { _store = store; }

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, Group);
        await Clients.Caller.SendAsync("ReceiveHistory", _store.Recent());
        await base.OnConnectedAsync();
    }

    /// <summary>Publie un message.  Le pseudo doit avoir été enregistré (jeton valide).</summary>
    public async Task Send(string userName, string token, string text)
    {
        if (!_store.Validate(userName, token))
        {
            await Clients.Caller.SendAsync("ChatError",
                "Pseudo non reconnu. Ré-enregistrez votre pseudo pour discuter.");
            return;
        }

        var msg = _store.Add(userName, text);
        if (msg is null)
        {
            await Clients.Caller.SendAsync("ChatError", "Message vide ou base indisponible.");
            return;
        }

        await Clients.Group(Group).SendAsync("ReceiveChat", msg);
    }
}
