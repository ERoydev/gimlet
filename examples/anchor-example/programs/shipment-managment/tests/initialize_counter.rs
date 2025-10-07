use litesvm::{LiteSVM};
use sha2::{Digest, Sha256};
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::{pubkey, Pubkey};
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_sdk_ids::system_program;

#[test]
fn test_initialize_counter() {
    let mut svm = LiteSVM::new();
    let program_id = pubkey!("6GYuei9hR62ZJgmSxFAxqp5xfyzYnH3ErTaPJ5J4zoYw");

    // Load program binary
    // Must register the compiled program into the VM before sending transactions to it
    svm.add_program_from_file(
        program_id, 
        "../../target/deploy/shipment_managment.so"
    ).unwrap();
    
    // Derive PDA
    let counter_seeds: &[&[u8]] = &[b"counter"];
    let (counter_pubkey, counter_bump) = Pubkey::find_program_address(counter_seeds, &program_id);

    // Create authority
    let authority_keypair = Keypair::new();
    let authority_pubkey = authority_keypair.pubkey();
    svm.airdrop(&authority_pubkey, 10_000_000).unwrap();


    // 1. Compute the Anchor discriminator
    let mut hasher = Sha256::new();
    hasher.update("global:initialize_counter".as_bytes());
    let hash = hasher.finalize();
    let discriminator: &[u8] = &hash[..8]; // First 8 bytes

    // 2. Serialize the argument with Borsh
    let initial_count: u64 = 12;
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(discriminator);
    instruction_data.extend_from_slice(&initial_count.to_le_bytes());

    // 3. Create the Accounts
    let accounts = vec![
        AccountMeta::new(counter_pubkey, false),
        AccountMeta::new(authority_pubkey, true),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    // 4. Build instruction
    let instruction = Instruction {
        program_id,
        accounts,
        data: instruction_data,
    };

    // 5. Build and send transaction
    let message = Message::new(&[instruction], Some(&authority_pubkey));
    let tx = Transaction::new(
        &[&authority_keypair],
        message,
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Transaction failed: {:?}", result.err());
}

#[test]
fn test_create_shipment() {
    let mut svm: LiteSVM = LiteSVM::new();
    let program_id = pubkey!("6GYuei9hR62ZJgmSxFAxqp5xfyzYnH3ErTaPJ5J4zoYw");

    // Load program binary
    // Must register the compiled program into the VM before sending transactions to it
    svm.add_program_from_file(
        program_id, 
        "../../target/deploy/shipment_managment.so"
    ).unwrap();

    // Derive PDA
    let counter_seeds: &[&[u8]] = &[b"counter"];
    let (counter_pubkey, counter_bump) = Pubkey::find_program_address(counter_seeds, &program_id);

    // Create authority
    let authority_keypair = Keypair::new();
    let authority_pubkey = authority_keypair.pubkey();
    svm.airdrop(&authority_pubkey, 10_000_000).unwrap();

    // 1. Compute the Anchor discriminator
    let mut hasher = Sha256::new();
    hasher.update("global:initialize_counter".as_bytes());
    let hash = hasher.finalize();
    let discriminator: &[u8] = &hash[..8]; // First 8 bytes

    // 2. Serialize the argument with Borsh
    let initial_count: u64 = 0;
    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(discriminator);
    instruction_data.extend_from_slice(&initial_count.to_le_bytes());

    // 3. Create the Accounts
    let accounts = vec![
        AccountMeta::new(counter_pubkey, false),
        AccountMeta::new(authority_pubkey, true),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    // 4. Build instruction
    let instruction = Instruction {
        program_id,
        accounts,
        data: instruction_data,
    };

    // 5. Build and send transaction
    let message = Message::new(&[instruction], Some(&authority_pubkey));
    let tx = Transaction::new(
        &[&authority_keypair],
        message,
        svm.latest_blockhash(),
    );

    let result = svm.send_transaction(tx);
    assert!(result.is_ok(), "Transaction failed: {:?}", result.err());

    // Now, create the shipment
    let mut hasher = Sha256::new();
    hasher.update("global:create_shipment".as_bytes());
    let hash = hasher.finalize();
    let discriminator: &[u8] = &hash[..8];

    // After initialize_counter, counter.count is 0, but after create_shipment it will increment
    // So for the first shipment, use 0 as the count
    let count_bytes = initial_count.to_le_bytes();
    let shipment_seeds: &[&[u8]] = &[b"shipment", &count_bytes];
    let (shipment_pubkey, _shipment_bump) = Pubkey::find_program_address(shipment_seeds, &program_id);

    let mut instruction_data = Vec::new();
    instruction_data.extend_from_slice(discriminator);

    let accounts = vec![
        AccountMeta::new(counter_pubkey, false),
        AccountMeta::new(shipment_pubkey, false),
        AccountMeta::new(authority_pubkey, true),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    let instruction = Instruction {
        program_id,
        accounts,
        data: instruction_data,
    };
    let message = Message::new(&[instruction], Some(&authority_pubkey));
    let tx = Transaction::new(
        &[&authority_keypair],
        message,
        svm.latest_blockhash(),
    );
    let result = svm.send_transaction(tx);
    if let Err(e) = &result {
        println!("Create shipment failed: {:?}", e);
    }
    assert!(result.is_ok(), "Transaction failed: {:?}", result.err());
}