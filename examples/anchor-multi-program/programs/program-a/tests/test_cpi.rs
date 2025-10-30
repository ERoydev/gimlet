use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::pubkey;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;

#[test]
fn test_cpi() {
    let mut svm: LiteSVM = LiteSVM::new();


    let program_id = pubkey!("ALkpavDZFcbRNjZn8cf3ptLfT9DSYQ3hkKBxeZPAXYz2");
    svm.add_program_from_file(program_id, "../../target/deploy/program_a.so")
        .unwrap();

    // Load program B
    let program_b_id = pubkey!("G8pztLe793X3k3u8FGVdyM9aBaqY8UPYuknzKVyay9N4");
    svm.add_program_from_file(program_b_id, "../../target/deploy/program_b.so")
        .unwrap();

    let signer_keypair = Keypair::new();
    let signer_pubkey = signer_keypair.pubkey();
    svm.airdrop(&signer_pubkey, 10_000_000).unwrap();

    // 1. This is the IDL of the cpi method in program A - see programs/program-a/src/lib.rs -> Discriminator of the cpi method
    let ix_data = vec![76, 173, 6, 95, 181, 93, 83, 206];

    // 2. Create the Accounts
    let accounts_ix = vec![
        // AccountMeta::new(signer_pubkey, true),
        AccountMeta::new(program_b_id, false),
        // AccountMeta::new_readonly(system_program::ID, false),
    ];

    // 3. Build instruction for program_a
    let instruction_a = Instruction {
        program_id,
        accounts: accounts_ix,
        data: ix_data,
    };

    // 5. Build and send transaction with both instructions
    let message = Message::new(&[instruction_a.clone()], Some(&signer_pubkey));
    let tx = Transaction::new(&[&signer_keypair], message, svm.latest_blockhash());

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Transaction failed: {:#?}", result.err()); // TODO: IMPORTANT usage of `#` will format the error
}

fn test_non_cpi() {
    let mut svm: LiteSVM = LiteSVM::new();

    let program_id = pubkey!("2BJiU3UUhRmroYHXN6iEcbuw7PfDAJqcFRv9AFutQxzQ");
    svm.add_program_from_file(program_id, "../../target/deploy/program_a.so")
        .unwrap();

    let signer_keypair = Keypair::new();
    let signer_pubkey = signer_keypair.pubkey();
    svm.airdrop(&signer_pubkey, 10_000_000).unwrap();

    let accounts_ix = vec![];

    let ix_data = vec![86, 36, 10, 211, 246, 235, 42, 57];

    let instruction_a = Instruction {
        program_id,
        accounts: accounts_ix,
        data: ix_data,
    };

    let message = Message::new(&[instruction_a], Some(&signer_pubkey));
    let tx = Transaction::new(&[&signer_keypair], message, svm.latest_blockhash());

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Transaction failed: {:#?}", result.err()); // TODO: IMPORTANT usage of `#` will format the error
}
