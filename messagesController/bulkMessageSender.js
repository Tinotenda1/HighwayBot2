 
  
  
  //console.log("Message:", message);
  
  /*
  if (
    user === "263777937111" &&
    messageType === "text" &&
    message?.text?.body?.trim().toLowerCase() === "send_group_message"
        ) {
          // Predefined message to send
          const predefinedMessage = "🚦 *PASS YOUR VID PROVISIONAL LICENSE.* \nPRACTICE NOW FOR FREE ON WHATSAPP! 🚗💨 \n\n🎉 *No apps, no stress – Just WhatsApp!* 🎉 \nAll you need to do is *say “Hi” to +263771470006 on WhatsApp* and start preparing for your *Provisional License* **RIGHT AWAY!**  \n\n📢 *What’s Inside?*  \n✅ *Specialized Tests* on 🚦 Road Signs, 🛑 Traffic Intersections & 📜 Theory Questions!  \n✅ *8-Minute Timed Test* ⏳ – Just like the actual VID exam! - Same questions, same diagrams, same test time.  \n✅ *Downloads* 📥 – Highway Code, Road Signs & Practice Q&A!  \n✅ *Everything happens on WhatsApp 💬 – No extra apps needed!* \n\nJust send a *“Hi” to +263771470006* and start learning instantly! 📲  \n\n🔥 *Tag a friend who needs this! Let’s hit the road!* 🚘💨";
          //const predefinedMessage = "test";    
          const image_no = 10006; // Specify the image_no to fetch from the database

          try {
                const imageData = await getImageFromDatabase(image_no);
                if (imageData !== "Image not found.") {
                  const filePath = path.join(__dirname, 'temp_image.jpg');
                  fs.writeFileSync(filePath, Buffer.from(imageData, 'base64'));

                  // Upload image to the platform and get media ID
                  const mediaId = await uploadImage(filePath, businessPhoneNumberId);
                  console.log("Media ID: ", mediaId);
                  await markAsRead(businessPhoneNumberId, messageId);

                  if (mediaId) {
          
                    
                    // Fetch all users' phone numbers from the "users" table
                      const [rows] = await connection.execute("SELECT phone FROM users");
                      
                      for (const row of rows) {
                        // Send the predefined message with the image to each user
                     await sendImageMessage(businessPhoneNumberId,row.phone, mediaId, predefinedMessage);
                     console.log("User's Number:",row.phone );
                      }
                    
                    //await sendImageMessage(businessPhoneNumberId,263714123745, mediaId, predefinedMessage);
                      console.log("Group message with image sent to all users.");
                     
                      fs.unlinkSync(filePath);  // Delete the temporary image file after sending
                  }
                }
            
          } catch (error) {
            console.error("Error sending group message with image:", error);
          }
          return res.sendStatus(200);
        }
*/
  
  
  